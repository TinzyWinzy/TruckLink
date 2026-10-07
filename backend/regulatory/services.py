"""Authorized, transactional provenance, evaluation and gate commands."""
from datetime import timezone as datetime_timezone

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from compliance.policy import MANDATORY_CHECKLIST_IDS
from core.audit import append_audit
from core.models import Facility
from trip.models import UserRole
from trip.permissions import get_user_organisation, get_user_role, in_facility
from yard.models import QueueEntry, Alert
from . import models as m
from .engine.evaluator import digest, evaluate, mass

REVIEWERS = (UserRole.ADMIN, UserRole.COMPLIANCE_OFFICER)
INSPECTORS = (UserRole.DISPATCH_SUPERVISOR,)
OPERATORS = (UserRole.OPERATIONS_SUPERVISOR, UserRole.ADMIN)


def require_role(actor, roles, facility=None):
    if get_user_role(actor) not in roles or get_user_organisation(actor) is None:
        raise PermissionError('Role is not authorized for this regulatory command')
    from core.rbac import rbac_allows
    resource = ('regulatory','inspect') if roles == INSPECTORS else ('regulatory','operate') if roles == OPERATORS else ('regulatory','review') if roles == REVIEWERS else None
    if resource and not rbac_allows(get_user_role(actor),*resource,get_user_organisation(actor),facility):
        raise PermissionError('Tenant policy does not authorize this command')


def assert_site(actor, entry):
    if entry.organisation_id != getattr(get_user_organisation(actor), 'pk', None) or not in_facility(actor, entry.facility):
        raise PermissionError('Record is outside authorized tenant/site')


def iso(value):
    return value.astimezone(datetime_timezone.utc).isoformat()


def reviewed(subject):
    field = {m.SourceRevision: 'source', m.EvidenceRevision: 'evidence', m.VehicleConfiguration: 'configuration'}[type(subject)]
    review = m.Review.objects.filter(**{field: subject}).order_by('-created_at', '-pk').first()
    return bool(review and review.approved), review


def source_snapshot(source):
    return {key: getattr(source, key).isoformat() if key in ('published_on', 'effective_from', 'effective_to') and getattr(source, key) else getattr(source, key)
            for key in ('id', 'source_key', 'revision', 'title', 'authority', 'jurisdiction', 'kind', 'tier',
                        'provision', 'document_ref', 'document_sha256', 'published_on', 'effective_from', 'effective_to')}


def unit_snapshot(unit):
    return {'id': unit.pk, 'rule_key': unit.rule_key, 'revision': unit.revision,
            'definition': unit.definition, 'source': source_snapshot(unit.source)}


@transaction.atomic
def review_record(actor, subject, approved, reason):
    require_role(actor, REVIEWERS)
    if subject.organisation_id != get_user_organisation(actor).pk:
        raise PermissionError('Record is outside tenant')
    # Serializes review append order with publication/release on the tenant lock.
    from trip.models import Organisation
    Organisation.objects.select_for_update().get(pk=subject.organisation_id)
    field = {m.SourceRevision: 'source', m.EvidenceRevision: 'evidence', m.VehicleConfiguration: 'configuration'}[type(subject)]
    return m.Review.objects.create(organisation=subject.organisation, creator=actor,
                                  approved=approved, reason=reason, **{field: subject})


@transaction.atomic
def create_ruleset(actor, *, unit_ids, **fields):
    require_role(actor, REVIEWERS)
    org = get_user_organisation(actor)
    units = list(m.RuleUnit.objects.filter(organisation=org, pk__in=unit_ids).select_related('source').order_by('pk'))
    if len(units) != len(unit_ids) or not units or len({u.rule_key for u in units}) != len(units):
        raise ValidationError('Choose unique tenant rule revisions; one revision per rule key')
    for unit in units:
        if unit.source.jurisdiction != fields['jurisdiction']:
            raise ValidationError('Source jurisdiction must match ruleset')
    content = {**fields, 'effective_from': fields['effective_from'].isoformat(),
               'effective_to': fields['effective_to'].isoformat(), 'schema_version': 1,
               'units': [unit_snapshot(u) for u in units]}
    ruleset = m.RuleSetVersion.objects.create(organisation=org, creator=actor, **fields,
                                             content=content, digest=digest(content))
    for unit in units:
        m.RuleSetMember.objects.create(organisation=org, creator=actor, ruleset=ruleset, unit=unit)
    return ruleset


def validate_bundle(ruleset, at):
    """Recheck provenance and current review status without mutating old results."""
    day = at.date()
    if not ruleset.effective_from <= day <= ruleset.effective_to or ruleset.digest != digest(ruleset.content):
        raise ValidationError('Ruleset is outside effective dates or its digest is invalid')
    units = list(ruleset.members.select_related('unit__source').order_by('unit_id'))
    if [unit_snapshot(x.unit) for x in units] != ruleset.content['units']:
        raise ValidationError('Published membership does not match immutable bundle')
    for member in units:
        source = member.unit.source
        if not reviewed(source)[0] or source.effective_from > day or (source.effective_to and source.effective_to < day):
            raise ValidationError('Source is unverified, revoked or outside effective dates')


@transaction.atomic
def publish_ruleset(actor, ruleset, reason):
    require_role(actor, REVIEWERS)
    org = get_user_organisation(actor)
    if ruleset.organisation_id != org.pk:
        raise PermissionError('Record is outside tenant')
    from trip.models import Organisation
    Organisation.objects.select_for_update().get(pk=org.pk)
    if actor.pk == ruleset.creator_id or any(x.unit.creator_id == actor.pk for x in ruleset.members.select_related('unit')):
        raise ValidationError('Publication reviewer must be independent of ruleset and control authors')
    if not reason.strip():
        raise ValidationError('Publication review reason required')
    # Future windows are permitted, but every source must cover the entire window.
    validate_bundle(ruleset, timezone.datetime.combine(ruleset.effective_from, timezone.datetime.min.time(), tzinfo=datetime_timezone.utc))
    for member in ruleset.members.select_related('unit__source'):
        source = member.unit.source
        if source.effective_to and source.effective_to < ruleset.effective_to:
            raise ValidationError('Source does not cover the ruleset effective window')
    conflicts = m.RuleSetVersion.objects.filter(organisation=org, jurisdiction=ruleset.jurisdiction,
        route_type=ruleset.route_type, publication__isnull=False,
        effective_from__lte=ruleset.effective_to, effective_to__gte=ruleset.effective_from)
    if conflicts.exists():
        raise ValidationError('Published ruleset effective windows overlap for this scope')
    return m.Publication.objects.create(organisation=org, creator=actor, ruleset=ruleset, reason=reason)


def bundles_for(context, at):
    bundles = []
    from tenancy.releases import active_release,artifacts
    release = active_release(context.organisation,at)
    assigned = artifacts(release,context.queue_entry.facility,kind='PACK_ASSIGNMENT',at=at) if release else []
    for jurisdiction in context.jurisdictions:
        selected = [r for r in assigned if r.content['jurisdiction'] == jurisdiction and r.content['route_type'] == context.route_type]
        local = [r for r in selected if r.facility_id == context.queue_entry.facility_id]
        selected = local or [r for r in selected if r.facility_id is None]
        if selected:
            if len(selected) != 1:
                raise ValidationError('CONFIGURATION_REQUIRED: ambiguous platform pack assignment')
            from .knowledge import KnowledgeRevision,validate_pack
            pack = KnowledgeRevision.objects.get(pk=selected[0].content['pack_id'],kind='PACK')
            validate_pack(pack,at)
            bundles.append({'id':f'pack:{pack.pk}','digest':pack.digest,'content':pack.content,
                'publication_id':pack.reviews.order_by('-created_at','-pk').first().pk,
                'max_age_seconds':pack.content['max_age_seconds'],'assignment_id':selected[0].pk})
            continue
        from .catalogue import shared_bundle
        shared = shared_bundle(context,jurisdiction,at)
        candidates = list(m.RuleSetVersion.objects.filter(organisation=context.organisation, jurisdiction=jurisdiction,
            route_type=context.route_type, publication__isnull=False, effective_from__lte=at.date(), effective_to__gte=at.date()))
        if len(candidates) > 1 or (not candidates and not shared):
            raise ValidationError(f'CONFIGURATION_REQUIRED: exactly one published ruleset required for {jurisdiction}/{context.route_type}')
        if shared:
            bundles.append(shared)
            if not candidates:
                continue
            if any(unit['source']['kind'] != 'INTERNAL_POLICY' for unit in candidates[0].content['units']):
                raise ValidationError('CONFIGURATION_REQUIRED: adopted platform rules may only be combined with tenant internal policies')
            if {u['rule_key'] for u in shared['content']['units']} & {u['rule_key'] for u in candidates[0].content['units']}:
                raise ValidationError('CONFIGURATION_REQUIRED: tenant policy rule keys must not collide with platform rules')
        ruleset = candidates[0]
        validate_bundle(ruleset, at)
        bundles.append({'id': ruleset.pk, 'digest': ruleset.digest, 'content': ruleset.content,
                        'publication_id': ruleset.publication.pk, 'max_age_seconds': ruleset.max_age_seconds})
    if release and not release.compatibility:
        from tenancy.models import ArtifactReview
        for policy in artifacts(release,context.queue_entry.facility,kind='POLICY',at=at):
            review = ArtifactReview.objects.filter(artifact=policy).order_by('-created_at','-pk').first()
            if policy.creator_id and (not review or not review.approved):
                raise ValidationError('Tenant policy is unapproved or revoked')
            source = {'id':f'policy:{policy.pk}','source_key':policy.key,'revision':policy.version,
                'kind':'INTERNAL_POLICY','classification':'TENANT_POLICY','authority':context.organisation.name,
                'title':policy.key,'jurisdiction':'TENANT','provision':policy.key,
                'document_ref':policy.content['document_ref'],'document_sha256':policy.content['document_sha256'],
                'effective_from':policy.effective_from.isoformat(),'effective_to':policy.effective_to.isoformat() if policy.effective_to else None}
            units = [{'id':f'policy:{policy.pk}:{c["key"]}','rule_key':c['key'],'revision':policy.version,
                'definition':c['definition'],'source':source} for c in policy.content['controls']]
            bundles.append({'id':f'policy:{policy.pk}','digest':policy.digest,'content':{'units':units,
                'name':f'Tenant policy: {policy.key}','version':policy.version,'classification':'TENANT_POLICY'},
                'publication_id':review.pk if review else None,'max_age_seconds':86400})
    return bundles


def context_snapshot(context, at):
    config = context.configuration
    config.full_clean()
    if not reviewed(config)[0] or config.effective_from > at.date() or (config.effective_to and config.effective_to < at.date()):
        raise ValidationError('CONFIGURATION_REQUIRED: vehicle configuration requires independent current review')
    if config.vehicle.is_deleted or context.driver.is_deleted or context.trip.status == 'cancelled':
        raise ValidationError('Context entity has been retired')
    context.full_clean()  # Also detects changed trip assignment/registration.
    evidence = list(context.evidence.all())
    if config.rating_evidence_id not in {e.pk for e in evidence}:
        evidence.append(config.rating_evidence)
    snapshots = []
    for item in sorted(evidence, key=lambda x: x.pk):
        approved, review = reviewed(item)
        subject = next(k for k in ('vehicle', 'driver', 'trip', 'load') if getattr(item, f'{k}_id'))
        superseded = m.EvidenceRevision.objects.filter(organisation=item.organisation, evidence_key=item.evidence_key, revision__gt=item.revision).exists()
        usable = approved and item.issued_at <= at < item.expires_at and not superseded
        snapshots.append({'id': item.pk, 'revision': item.revision, 'kind': item.kind, 'issuer': item.issuer,
                          'subject': subject, 'entity_id': getattr(item, f'{subject}_id'),
                          'document_ref': item.document_ref, 'document_sha256': item.document_sha256,
                          'issued_at': iso(item.issued_at), 'expires_at': iso(item.expires_at),
                          'review_id': review.pk if review else None, 'usable': usable})
    if not any(e['id'] == config.rating_evidence_id and e['usable'] for e in snapshots):
        raise ValidationError('CONFIGURATION_REQUIRED: independently reviewed current vehicle-rating evidence required')
    return {'context_id': context.pk, 'configuration_id': config.pk, 'configuration_revision': config.revision,
            'vehicle_id': config.vehicle_id, 'registration': config.vehicle.plate,
            'vehicle_class': config.vehicle_class, 'axle_layout': config.axle_layout,
            'rated_axle_kg': [str(mass(x)) for x in config.rated_axle_kg], 'rated_gross_kg': str(config.rated_gross_kg),
            'driver_id': context.driver_id, 'trip_id': context.trip_id, 'load_id': context.load_id,
            'cargo_class': context.load.cargo_class, 'declared_mass_kg': str(context.load.declared_mass_kg),
            'dimensions_mm': context.load.dimensions_mm, 'route_type': context.route_type,
            'jurisdictions': context.jurisdictions, 'origin': context.origin, 'destination': context.destination,
            'evidence': snapshots}


@transaction.atomic
def create_context(actor, entry, *, evidence_ids, **fields):
    require_role(actor, INSPECTORS if get_user_role(actor) in INSPECTORS else OPERATORS, entry.facility)
    assert_site(actor, entry)
    entry = QueueEntry.objects.select_for_update().get(pk=entry.pk)
    if entry.status == 'RELEASED':
        raise ValidationError('Released context is historical')
    from journeys.models import JourneyLink
    link = JourneyLink.objects.filter(visit=entry).first()
    if link and link.trip_id != fields['trip'].pk:
        raise ValidationError('Inspection context must use the linked journey trip')
    context = m.OperationalContext.objects.create(organisation=entry.organisation, creator=actor, queue_entry=entry, **fields)
    evidence = list(m.EvidenceRevision.objects.filter(organisation=entry.organisation, pk__in=evidence_ids))
    if len(evidence) != len(evidence_ids):
        raise ValidationError('Choose unique evidence revisions in the tenant')
    for item in evidence:
        m.ContextEvidence.objects.create(organisation=entry.organisation, creator=actor, context=context, evidence=item)
    # Context corrections invalidate operational eligibility until a fresh attempt.
    if entry.inspection_attempts.exists():
        entry.status = 'QUARANTINED'
        entry.save(update_fields=['status', 'updated_at'])
    append_audit(facility=entry.facility, actor=actor, action='RECORD_OPERATIONAL_CONTEXT', payload={'context_id': context.pk, 'queue_entry_id': entry.pk,'trip_id':context.trip_id,'reg_number':entry.reg_number})
    return context


def evaluate_inspection(bundles, snapshot, inputs, policy=None):
    result = evaluate(bundles, snapshot, inputs)
    required = policy['mandatory_checks'] if policy else MANDATORY_CHECKLIST_IDS
    if policy:
        result['tenant_policy'] = policy
    missing = [key for key in required if inputs['checklist_results'].get(key) is not True]
    if missing:
        result['controls'].append({'id': 'inspection.attestations', 'status': 'HOLD', 'reason': 'Missing operational attestations',
                                   'missing': missing, 'override_policy': 'NOT_ALLOWED'})
        if result['decision'] in ('PASS', 'PASS_WITH_WARNINGS'):
            result['decision'] = 'HOLD'
        result['override_eligible'] = False
        applicable = [c for c in result['controls'] if c['status'] != 'NOT_APPLICABLE']
        result['readiness_percent'] = round(100 * sum(c['status'] == 'PASS' for c in applicable) / len(applicable), 2)
    return result


@transaction.atomic
def inspect_entry(actor, entry, *, axle_weights, total_weight, checklist_results, client_key='', context_id=None):
    require_role(actor, INSPECTORS,entry.facility)
    assert_site(actor, entry)
    entry = QueueEntry.objects.select_for_update().get(pk=entry.pk)
    Facility.objects.select_for_update().get(pk=entry.facility_id)
    from trip.models import Organisation
    Organisation.objects.select_for_update().get(pk=entry.organisation_id)
    inputs = {'axle_weights': [str(mass(x)) for x in axle_weights], 'total_weight': str(mass(total_weight)),
              'checklist_results': checklist_results}
    submission = digest({'queue_entry': entry.pk, 'context_id': context_id, **inputs})
    if client_key:
        prior = m.InspectionAttempt.objects.filter(facility=entry.facility, client_key=client_key).first()
        if prior:
            if prior.submission_digest != submission or prior.creator_id != actor.pk:
                raise ValidationError('Idempotency key belongs to another actor or submission')
            return prior, True
    if entry.status == 'RELEASED':
        raise ValidationError('Cannot inspect released entry')
    at = timezone.now()
    context = entry.regulatory_contexts.order_by('-created_at', '-pk').first()
    if context_id is not None and (context is None or context.pk != context_id):
        raise ValidationError('Context changed; refresh before recording this inspection')
    snapshot, bundles, tenant_snapshot = {}, [], {}
    try:
        from tenancy.releases import snapshot as configuration_snapshot
        tenant_snapshot = configuration_snapshot(entry.organisation,entry.facility)
        if context is None:
            raise ValidationError('CONFIGURATION_REQUIRED: recorded vehicle/driver/trip/load/route context is missing')
        snapshot = context_snapshot(context, at)
        bundles = bundles_for(context, at)
        from tenancy.configuration import workflow
        result = evaluate_inspection(bundles, snapshot, inputs, workflow(entry.organisation,entry.facility))
    except ValidationError as exc:
        result = {'decision': 'REVIEW_REQUIRED', 'controls': [{'id': 'configuration', 'status': 'REVIEW_REQUIRED',
                  'reason': '; '.join(exc.messages), 'override_policy': 'NOT_ALLOWED'}], 'readiness_percent': 0,
                  'override_eligible': False, 'engine_version': 'nrok-1', 'monetary_penalty': None}
    attempt = m.InspectionAttempt.objects.create(organisation=entry.organisation, facility=entry.facility, creator=actor,
        queue_entry=entry, context=context, client_key=client_key, submission_digest=submission, occurred_at=at,
        input_snapshot=inputs, context_snapshot=snapshot, ruleset_snapshot=bundles, result=result, decision=result['decision'],
        tenant_configuration_snapshot=tenant_snapshot)
    previous_status=entry.status
    entry.status = 'COMPLETED' if attempt.decision in ('PASS', 'PASS_WITH_WARNINGS') else 'QUARANTINED'
    entry.save(update_fields=['status', 'updated_at'])
    if entry.status == 'QUARANTINED':
        Alert.objects.create(organisation=entry.organisation, facility=entry.facility, severity='CRITICAL', category='REGULATORY',
            related_queue_entry=entry, message=f'{entry.reg_number}: {attempt.decision}; inspection {attempt.pk} requires action. No monetary penalty calculated.')
    append_audit(facility=entry.facility, actor=actor, action='EVALUATE_REGULATORY', payload={'attempt_id': attempt.pk,
        'queue_entry_id':entry.pk,'reg_number':entry.reg_number,'trip_id':context.trip_id if context else None,
        'previous_state':previous_status,'new_state':entry.status,
        'decision': attempt.decision, 'result_digest': digest(result), 'rulesets': [{'id': b['id'], 'digest': b['digest']} for b in bundles]})
    return attempt, False


def lock_current_attempt(actor, attempt, *, departure_release=None):
    entry = QueueEntry.objects.select_for_update().get(pk=attempt.queue_entry_id)
    assert_site(actor, entry)
    current = entry.inspection_attempts.first()
    context = entry.regulatory_contexts.order_by('-created_at', '-pk').first()
    released_authority = (departure_release is not None and entry.status == 'RELEASED'
        and departure_release.queue_entry_id == entry.pk and departure_release.attempt_id == attempt.pk)
    if (entry.status == 'RELEASED' and not released_authority) or not current or current.pk != attempt.pk or not context or attempt.context_id != context.pk:
        raise ValidationError('Only the current attempt and context can authorize gate commands')
    return entry


@transaction.atomic
def request_override(actor, attempt, reason):
    require_role(actor, OPERATORS,attempt.facility)
    entry = lock_current_attempt(actor, attempt)
    if not attempt.result.get('override_eligible') or not reason.strip():
        raise ValidationError('This attempt cannot be overridden; remediate and re-evaluate')
    if entry.status != 'QUARANTINED':
        raise ValidationError('Override requires a currently held vehicle')
    request = m.OverrideRequest.objects.create(organisation=attempt.organisation, creator=actor, attempt=attempt, reason=reason)
    entry.status = 'PENDING_OVERRIDE'
    entry.save(update_fields=['status', 'updated_at'])
    append_audit(facility=entry.facility, actor=actor, action='REQUEST_REGULATORY_OVERRIDE', payload={'request_id': request.pk, 'attempt_id': attempt.pk, 'reason': reason,
        'queue_entry_id':entry.pk,'reg_number':entry.reg_number,'trip_id':attempt.context.trip_id,'previous_state':'QUARANTINED','new_state':entry.status})
    return request


@transaction.atomic
def approve_override(actor, request, approved, reason):
    require_role(actor, OPERATORS,request.attempt.facility)
    entry = lock_current_attempt(actor, request.attempt)
    latest = request.attempt.override_requests.order_by('-created_at', '-pk').first()
    if latest.pk != request.pk or entry.status != 'PENDING_OVERRIDE' or not request.attempt.result.get('override_eligible'):
        raise ValidationError('Only the current pending request can be decided')
    approval = m.OverrideApproval.objects.create(organisation=request.organisation, creator=actor, request=request, approved=approved, reason=reason)
    entry.status = 'OVERRIDE_APPROVED' if approved else 'QUARANTINED'
    entry.save(update_fields=['status', 'updated_at'])
    append_audit(facility=entry.facility, actor=actor, action='DECIDE_REGULATORY_OVERRIDE', payload={'approval_id': approval.pk, 'attempt_id': request.attempt_id, 'approved': approved, 'reason': reason,
        'queue_entry_id':entry.pk,'reg_number':entry.reg_number,'trip_id':request.attempt.context.trip_id,'previous_state':'PENDING_OVERRIDE','new_state':entry.status})
    return approval


def release_authority(entry, actor, *, departure_release=None):
    """Caller holds queue lock; revalidate effective policy and evidence at exit."""
    require_role(actor, (UserRole.DISPATCH_SUPERVISOR, UserRole.OPERATIONS_SUPERVISOR, UserRole.FACILITY_MANAGER))
    from core.rbac import rbac_allows
    from tenancy.releases import require_module
    require_module(entry.organisation,'release')
    if not rbac_allows(get_user_role(actor),'queue','update',entry.organisation,entry.facility):
        raise PermissionError('Site permission profile does not authorize release')
    from trip.models import Organisation
    Organisation.objects.select_for_update().get(pk=entry.organisation_id)
    attempt = entry.inspection_attempts.first()
    if departure_release is not None:
        if (entry.status != 'RELEASED' or departure_release.queue_entry_id != entry.pk
                or not attempt or departure_release.attempt_id != attempt.pk):
            raise ValidationError('Departure must retain the current recorded release authority')
    if not attempt:
        raise ValidationError('CONFIGURATION_REQUIRED: current versioned inspection required')
    if attempt.engine_version != 'nrok-1':
        raise ValidationError('Unsupported historical engine; re-evaluate under the current version')
    lock_current_attempt(actor, attempt, departure_release=departure_release)
    now = timezone.now()
    snapshot = context_snapshot(attempt.context, now)
    bundles = bundles_for(attempt.context, now)
    if digest(snapshot) != digest(attempt.context_snapshot) or digest(bundles) != digest(attempt.ruleset_snapshot):
        raise ValidationError('Evidence or effective rules changed; re-evaluate before release')
    from tenancy.configuration import workflow
    from tenancy.releases import snapshot as configuration_snapshot,active_release
    current_configuration = configuration_snapshot(entry.organisation,entry.facility)
    if attempt.tenant_configuration_snapshot:
        if attempt.tenant_configuration_snapshot.get('decision_digest') != current_configuration.get('decision_digest'):
            raise ValidationError('Tenant workflow, site, policy or regulatory assignment changed; re-evaluate')
    elif active_release(entry.organisation) and not active_release(entry.organisation).compatibility:
        raise ValidationError('Tenant release changed; re-evaluate under its recorded configuration')
    policy = workflow(entry.organisation,entry.facility)
    historical_policy = attempt.result.get('tenant_policy')
    if historical_policy:
        if historical_policy['digest'] != policy['digest']:
            raise ValidationError('Tenant operational policy changed; re-evaluate before release')
    elif policy['mandatory_checks'] != list(MANDATORY_CHECKLIST_IDS):
        raise ValidationError('Tenant operational policy changed; re-evaluate before release')
    reconstructed = evaluate_inspection(bundles, snapshot, attempt.input_snapshot, historical_policy)
    if digest(reconstructed) != digest(attempt.result) or reconstructed['decision'] != attempt.decision:
        raise ValidationError('Inspection result does not reproduce under its recorded engine and policy')
    if (now - attempt.occurred_at).total_seconds() > min(policy['inspection_max_age_seconds'], *(b['max_age_seconds'] for b in bundles)):
        raise ValidationError('Inspection has expired; re-evaluate before release')
    approval = None
    if attempt.decision not in ('PASS', 'PASS_WITH_WARNINGS'):
        request = attempt.override_requests.order_by('-created_at', '-pk').first()
        approval = m.OverrideApproval.objects.filter(request=request, approved=True).first() if request else None
        if (not attempt.result.get('override_eligible') or not approval
                or (departure_release is None and entry.status != 'OVERRIDE_APPROVED')
                or (departure_release is not None and departure_release.approval_id != approval.pk)):
            raise ValidationError('Held attempt requires permitted independent approval')
    elif departure_release is None and entry.status != 'COMPLETED':
        raise ValidationError('Queue state is inconsistent with current inspection')
    return attempt, approval
