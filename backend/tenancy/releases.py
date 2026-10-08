"""Atomic tenant releases and typed, scoped configuration resolution."""
from copy import deepcopy
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from regulatory.engine.evaluator import digest
from .registry import MODULES, TEMPLATES, ADAPTERS


def active_release(org, at=None):
    from .models import ReleaseActivation
    row = ReleaseActivation.objects.filter(organisation=org,effective_from__lte=at or timezone.now()).order_by('-version').select_related('release').first()
    return row.release if row else None


def artifacts(release, facility=None, kind=None, at=None):
    from .models import TenantArtifactRevision
    now = at or timezone.now()
    rows = TenantArtifactRevision.objects.filter(pk__in=release.artifact_ids,organisation=release.organisation,
        effective_from__lte=now).order_by('pk')
    rows = [r for r in rows if r.effective_to is None or now < r.effective_to]
    if kind:
        rows = [r for r in rows if r.kind == kind]
    if facility is not None:
        local = [r for r in rows if r.facility_id == facility.pk]
        if kind in ('WORKFLOW','SITE','PERMISSIONS') and local:
            return local
        rows = [r for r in rows if r.facility_id in (None,facility.pk)]
    else:
        rows = [r for r in rows if r.facility_id is None]
    return rows


def release_config(release, facility=None, at=None):
    c = deepcopy(release.configuration.content)
    selected_workflow = artifacts(release,facility,kind='WORKFLOW',at=at)
    if selected_workflow:
        c['workflow'] = selected_workflow[0].content['workflow']
    for row in artifacts(release,facility,at=at):
        if row.kind == 'PERMISSIONS':
            for key, roles in row.content['grants'].items():
                c['permissions'][key] = [r for r in roles if r in c['permissions'].get(key,roles)]
        elif row.kind == 'INTEGRATION' and row.content['adapter'] != 'road-routing-v1':
            provider = ADAPTERS[row.content['adapter']]['provider']
            c['integrations'].setdefault('notifications',{})[provider] = {k:row.content[k] for k in ('enabled','env_prefix')}
    return c


def module_enabled(org, module):
    from .subscriptions import effective_modules
    return effective_modules(org).get(module,False)


def require_module(org, module):
    if not module_enabled(org,module):
        raise PermissionError(f'Tenant module {module} is disabled')


def snapshot(org, facility=None, strict=True):
    release = active_release(org)
    if not release:
        return {}
    rows = artifacts(release,facility)
    from .models import ArtifactReview
    issues = []
    for r in release.artifacts_for_activation():
        if r.facility_id not in (None,getattr(facility,'pk',None)):
            continue
        if r.kind in ('WORKFLOW','SITE','POLICY','PACK_ASSIGNMENT'):
            if r.effective_from > timezone.now() or (r.effective_to and r.effective_to <= timezone.now()):
                issues.append('CONFIGURATION_REQUIRED: selected configuration revision expired or not effective')
            if r.creator_id and r.kind in ('WORKFLOW','POLICY'):
                review = ArtifactReview.objects.filter(artifact=r).order_by('-created_at','-pk').first()
                if not review or not review.approved:
                    issues.append('Selected workflow or tenant policy approval is revoked')
    if strict and issues:
        raise ValidationError(issues)
    decision_rows = [r for r in rows if r.kind not in ('MODULES','PERMISSIONS','INTEGRATION')]
    return {'release_id':release.pk,'release_version':release.version,'release_digest':release.digest,
        'configuration_id':release.configuration_id,
        'artifacts':[{'id':r.pk,'kind':r.kind,'key':r.key,'version':r.version,'digest':r.digest} for r in rows],
        'decision_digest':digest([{'kind':r.kind,'key':r.key,'digest':r.digest} for r in decision_rows]),
        'readiness_errors':issues}


def validate_release(row):
    from .models import TenantArtifactRevision, ArtifactReview
    if row.configuration.organisation_id != row.organisation_id:
        raise ValidationError('Release configuration belongs to another tenant')
    ids = row.artifact_ids
    if not isinstance(ids,list) or not ids or any(type(i) is not int for i in ids) or len(set(ids)) != len(ids):
        raise ValidationError('Release requires distinct artifact revision IDs')
    rows = list(TenantArtifactRevision.objects.filter(pk__in=ids,organisation=row.organisation))
    if len(rows) != len(ids):
        raise ValidationError('Release references missing or foreign tenant configuration')
    modules = [r for r in rows if r.kind == 'MODULES']
    if len(modules) != 1 or modules[0].facility_id:
        raise ValidationError('Exactly one tenant-wide module configuration required')
    from .subscriptions import entitlement
    selected = {key for key,enabled in modules[0].content.items() if enabled}
    if not selected <= set(entitlement(row.organisation)['modules']):
        raise ValidationError('Selected modules require a platform-issued subscription entitlement')
    scopes = set()
    for r in rows:
        r.full_clean()
        # Release selection is exact: no competing revisions for a logical scoped key.
        scope = (r.kind,r.key,r.facility_id)
        if scope in scopes:
            raise ValidationError('Release contains ambiguous configuration versions')
        scopes.add(scope)
        if r.kind in ('WORKFLOW','POLICY') and r.creator_id:
            review = ArtifactReview.objects.filter(artifact=r).order_by('-created_at','-pk').first()
            if not review or not review.approved:
                raise ValidationError('Workflow and policy require independent current approval')
        if r.kind == 'WORKFLOW':
            if modules[0].content['yard'] and (not modules[0].content['inspection'] or not modules[0].content['release']):
                raise ValidationError('Yard workflow requires inspection and release modules')
        if r.kind == 'PACK_ASSIGNMENT':
            from regulatory.knowledge import validate_pack, KnowledgeRevision
            validate_pack(KnowledgeRevision.objects.get(pk=r.content['pack_id']),row.effective_from)
    if modules[0].content['yard'] and not any(r.kind == 'WORKFLOW' and r.facility_id is None for r in rows):
        raise ValidationError('Enabled yard requires a tenant-wide workflow default')
    # One binding per kind/scope; tenant-wide defaults and explicit site overrides are permitted.
    for kind in ('WORKFLOW','SITE','PERMISSIONS'):
        selected = [r for r in rows if r.kind == kind]
        if len({r.facility_id for r in selected}) != len(selected):
            raise ValidationError('Overlapping site configuration or workflow bindings')
    assignments = [r for r in rows if r.kind == 'PACK_ASSIGNMENT']
    scopes = [(r.facility_id,r.content['jurisdiction'],r.content['route_type']) for r in assignments]
    if len(set(scopes)) != len(scopes):
        raise ValidationError('Overlapping regulatory pack assignment')
    adapters = [r.content['adapter'] for r in rows if r.kind == 'INTEGRATION']
    if len(set(adapters)) != len(adapters):
        raise ValidationError('Ambiguous integration adapter bindings')
    if row.compatibility and row.creator_id:
        from .models import TenantReleaseVersion
        prior = TenantReleaseVersion.objects.filter(organisation=row.organisation,compatibility=True).order_by('-version').first()
        if not prior or prior.artifact_ids != row.artifact_ids or prior.configuration.content['workflow'] != row.configuration.content['workflow']:
            raise ValidationError('Compatibility semantics may only be retained for unchanged migrated workflow references')


@transaction.atomic
def activate(actor, release, expected_version, reason):
    from trip.models import Organisation
    from trip.permissions import get_user_role, get_user_organisation, user_facilities
    from .models import ReleaseActivation
    from core.audit import append_audit
    if get_user_role(actor) != 'ADMIN' or get_user_organisation(actor).pk != release.organisation_id:
        raise PermissionError('Tenant administrator required')
    Organisation.objects.select_for_update().get(pk=release.organisation_id)
    latest = ReleaseActivation.objects.filter(organisation=release.organisation).order_by('-version').first()
    current = latest.version if latest else 0
    if type(expected_version) is not int or expected_version != current:
        raise ValidationError('Activation changed; refresh before activation')
    release.full_clean()
    if release.effective_from > timezone.now():
        raise ValidationError('Release is not yet effective')
    for r in release.artifacts_for_activation():
        if r.effective_from > timezone.now() or (r.effective_to and timezone.now() >= r.effective_to):
            raise ValidationError('All selected revisions must be effective at activation')
    row = ReleaseActivation.objects.create(organisation=release.organisation,release=release,
        version=current+1,creator=actor,reason=reason,effective_from=timezone.now())
    for revision in release.artifacts_for_activation().filter(kind='SITE'):
        site = revision.facility
        site.timezone = revision.content['timezone']
        site.yard_config = revision.content['operating_parameters']
        site.save(update_fields=['timezone','yard_config'])
    for site in user_facilities(actor).filter(organisation=release.organisation,is_deleted=False):
        append_audit(facility=site,actor=actor,action='ACTIVATE_TENANT_RELEASE',payload={'release_id':release.pk,'activation_version':row.version,'digest':release.digest})
    return row
