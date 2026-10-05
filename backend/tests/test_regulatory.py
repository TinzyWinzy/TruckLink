"""Synthetic policies only: provenance, historical reproduction and live gate.

These tests verify software behavior; all thresholds/documents are invented
test fixtures and make no assertion about any instrument or monetary penalty.
"""
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from rest_framework.test import APIClient

from compliance.policy import MANDATORY_CHECKLIST_IDS
from regulatory import models as m, services as s
from regulatory.engine.evaluator import digest, evaluate, mass, validate_rule
from trip.models import UserProfile, UserRole, Vehicle, Driver, Trip, Organisation
from yard.models import QueueEntry
from yard.services import release_entry, ReleaseBlocked

pytestmark = pytest.mark.django_db


@pytest.fixture
def domain(default_org, default_facility, settings):
    settings.AUDIT_SALT = 'synthetic-regulatory-test'
    default_facility.yard_config = {'mode': 'OPERATIONS'}
    default_facility.save()
    def user(name, role):
        actor = get_user_model().objects.create_user(username=name)
        profile = UserProfile.objects.create(user=actor, organisation=default_org, role=role)
        profile.facilities.add(default_facility)
        return actor
    author = user('author', UserRole.ADMIN)
    reviewer = user('reviewer', UserRole.COMPLIANCE_OFFICER)
    inspector = user('inspector', UserRole.DISPATCH_SUPERVISOR)
    ops = user('requester', UserRole.OPERATIONS_SUPERVISOR)
    ops2 = user('approver', UserRole.OPERATIONS_SUPERVISOR)
    org, at = default_org, timezone.now()
    fields = {'organisation': org, 'creator': author}
    vehicle = Vehicle.objects.create(organisation=org, plate='SYNTH 100')
    driver = Driver.objects.create(organisation=org, name='Synthetic driver')
    trip = Trip.objects.create(organisation=org, vehicle=vehicle, driver=driver, origin='Synthetic A', destination='Synthetic B')
    load = m.Load.objects.create(**fields, reference='synthetic-load', cargo_class='GENERAL', declared_mass_kg='10000')
    evidence = m.EvidenceRevision.objects.create(**fields, evidence_key='rating', revision=1, kind='VEHICLE_RATING',
        issuer='Synthetic manufacturer', document_ref='test://rating', document_sha256='a'*64,
        issued_at=at-timedelta(days=2), expires_at=at+timedelta(days=5), vehicle=vehicle)
    s.review_record(reviewer, evidence, True, 'Synthetic evidence reviewed')
    config = m.VehicleConfiguration.objects.create(**fields, vehicle=vehicle, revision=1, vehicle_class='TEST_TRUCK',
        axle_layout=[{'position':i+1, 'kind':'SYNTHETIC'} for i in range(3)], rated_axle_kg=['12000','12000','12000'],
        rated_gross_kg='36000', rating_evidence=evidence, effective_from=at.date()-timedelta(days=2))
    s.review_record(reviewer, config, True, 'Independent synthetic rating review')
    entry = QueueEntry.objects.create(organisation=org, facility=default_facility, reg_number=vehicle.plate, status='AT_DOCK')
    context = s.create_context(inspector, entry, configuration=config, driver=driver, trip=trip, load=load,
        route_type='DOMESTIC', jurisdictions=['TEST'], origin=trip.origin, destination=trip.destination, evidence_ids=[])
    source = m.SourceRevision.objects.create(**fields, source_key='synthetic-policy', revision=1, title='Synthetic operational policy',
        authority='Test owner', jurisdiction='TEST', kind='INTERNAL_POLICY', tier='D', provision='TEST ONLY',
        document_ref='test://policy', document_sha256='b'*64, published_on=at.date()-timedelta(days=2),
        effective_from=at.date()-timedelta(days=1), effective_to=at.date()+timedelta(days=100))
    rule = m.RuleUnit.objects.create(**fields, rule_key='gross', revision=1, source=source,
        definition={'kind':'GROSS_MAX', 'limit_kg':'24000', 'applicability':{},
                    'failure_action':'QUARANTINE', 'override_policy':'INDEPENDENT_APPROVAL'})
    s.review_record(reviewer, source, True, 'Synthetic internal policy; no legal assertion')
    ruleset = s.create_ruleset(author, name='synthetic', version=1, jurisdiction='TEST', route_type='DOMESTIC',
        effective_from=at.date()-timedelta(days=1), effective_to=at.date()+timedelta(days=3), max_age_seconds=3600, unit_ids=[rule.pk])
    s.publish_ruleset(reviewer, ruleset, 'Independent synthetic control review')
    inputs = {'axle_weights':['6000','8000','8000'], 'total_weight':'22000',
              'checklist_results':dict.fromkeys(MANDATORY_CHECKLIST_IDS, True), 'client_key':'attempt-1', 'context_id':context.pk}
    return locals()


def inspect(d, **changes):
    return s.inspect_entry(d['inspector'], d['entry'], **{**d['inputs'], **changes})[0]


def test_operational_evaluation_and_release_references_current_attempt(domain):
    d = domain
    attempt = inspect(d)
    assert attempt.decision == 'PASS' and attempt.result['monetary_penalty'] is None
    assert attempt.ruleset_snapshot[0]['digest'] == d['ruleset'].digest
    assert release_entry(d['entry'].pk, d['ops']).status == 'RELEASED'
    release = m.ReleaseRecord.objects.get(queue_entry=d['entry'])
    assert release.attempt_id == attempt.pk and release.approval is None


def test_original_inspection_unchanged_by_independent_override(domain):
    d = domain
    attempt = inspect(d, axle_weights=['9000','8000','8000'], total_weight='25000')
    original = digest(attempt.result)
    request = s.request_override(d['ops'], attempt, 'Synthetic permitted exception')
    with pytest.raises(ValidationError):
        s.approve_override(d['ops'], request, True, 'Self approval')
    s.approve_override(d['ops2'], request, True, 'Independent review')
    release_entry(d['entry'].pk, d['ops2'])
    attempt.refresh_from_db()
    assert attempt.decision == 'QUARANTINE' and digest(attempt.result) == original
    assert m.ReleaseRecord.objects.get().approval.request_id == request.pk


def test_configuration_required_is_recorded_not_passed(domain):
    d = domain
    s.review_record(d['reviewer'], d['source'], False, 'Review withdrawn')
    attempt = inspect(d)
    assert attempt.decision == 'REVIEW_REQUIRED' and not attempt.result['override_eligible']
    with pytest.raises(ReleaseBlocked):
        release_entry(d['entry'].pk, d['ops'])


def test_evidence_revocation_after_pass_blocks_exit(domain):
    d = domain
    inspect(d)
    s.review_record(d['reviewer'], d['evidence'], False, 'Evidence withdrawn')
    with pytest.raises(ReleaseBlocked):
        release_entry(d['entry'].pk, d['ops'])
    assert not m.ReleaseRecord.objects.exists()


def test_future_ruleset_does_not_rewrite_history_and_requires_new_evaluation(domain):
    d = domain
    attempt = inspect(d)
    original = digest(attempt.ruleset_snapshot)
    future = d['ruleset'].effective_to + timedelta(days=1)
    new = s.create_ruleset(d['author'], name='synthetic', version=2, jurisdiction='TEST', route_type='DOMESTIC',
        effective_from=future, effective_to=future+timedelta(days=1), max_age_seconds=3600, unit_ids=[d['rule'].pk])
    s.publish_ruleset(d['reviewer'], new, 'Synthetic future policy review')
    with patch('regulatory.services.timezone.now', return_value=timezone.now()+timedelta(days=5)):
        with pytest.raises(ReleaseBlocked):
            release_entry(d['entry'].pk, d['ops'])
    attempt.refresh_from_db()
    assert digest(attempt.ruleset_snapshot) == original
    assert evaluate(attempt.ruleset_snapshot, attempt.context_snapshot, attempt.input_snapshot)['decision'] == attempt.decision


def test_publish_requires_independent_review_and_nonoverlap(domain):
    d = domain
    new = s.create_ruleset(d['author'], name='other', version=1, jurisdiction='TEST', route_type='DOMESTIC',
        effective_from=d['ruleset'].effective_from, effective_to=d['ruleset'].effective_to, max_age_seconds=3600, unit_ids=[d['rule'].pk])
    with pytest.raises(ValidationError, match='independent'):
        s.publish_ruleset(d['author'], new, 'Self')
    with pytest.raises(ValidationError, match='overlap'):
        s.publish_ruleset(d['reviewer'], new, 'Overlapping')


def test_no_self_review_or_draft_control_activation(domain):
    d = domain
    with pytest.raises(ValidationError):
        s.review_record(d['author'], d['source'], True, 'Self')
    s.review_record(d['reviewer'], d['source'], False, 'Draft only')
    future = d['ruleset'].effective_to + timedelta(days=1)
    new = s.create_ruleset(d['author'], name='draft', version=1, jurisdiction='TEST', route_type='DOMESTIC',
        effective_from=future, effective_to=future, max_age_seconds=3600, unit_ids=[d['rule'].pk])
    with pytest.raises(ValidationError):
        s.publish_ruleset(d['reviewer'], new, 'Unreviewed content')


def test_ratings_and_missing_checks_cannot_be_overridden(domain):
    d = domain
    attempt = inspect(d, axle_weights=['13000','8000','8000'], total_weight='29000')
    assert not attempt.result['override_eligible']
    with pytest.raises(ValidationError):
        s.request_override(d['ops'], attempt, 'Unsafe rating bypass')
    missing = inspect(d, client_key='missing', checklist_results={})
    assert missing.decision == 'HOLD' and not missing.result['override_eligible']


def test_stale_approval_and_changed_context_are_rejected(domain):
    d = domain
    first = inspect(d, axle_weights=['9000','8000','8000'], total_weight='25000')
    request = s.request_override(d['ops'], first, 'Review')
    inspect(d, client_key='attempt-2')
    with pytest.raises(ValidationError):
        s.approve_override(d['ops2'], request, True, 'Stale')


def test_immutable_records_and_protected_history(domain):
    d = domain
    attempt = inspect(d)
    attempt.decision = 'PASS_WITH_WARNINGS'
    with pytest.raises(ValidationError):
        attempt.save()
    with pytest.raises(ValidationError):
        m.SourceRevision.objects.filter(pk=d['source'].pk).update(title='Tampered')
    with pytest.raises(ProtectedError):
        d['entry'].delete()
    with pytest.raises(ValidationError):
        m.RuleSetMember.objects.create(organisation=d['org'], creator=d['author'], ruleset=d['ruleset'], unit=d['rule'])


def test_replay_ownership_payload_and_original_result(domain):
    d = domain
    attempt = inspect(d)
    prior, replayed = s.inspect_entry(d['inspector'], d['entry'], **d['inputs'])
    assert replayed and prior.pk == attempt.pk
    with pytest.raises(ValidationError):
        inspect(d, total_weight='23000')
    assert m.InspectionAttempt.objects.count() == 1


def test_api_scopes_foreign_entities_and_rejects_caller_ratings(domain):
    d = domain
    client = APIClient()
    client.force_authenticate(d['inspector'])
    body = {'queue_entry': d['entry'].pk, **d['inputs']}
    assert client.post('/api/regulatory/evaluate/', {**body, 'gvm_rating':999999}, format='json').status_code == 400
    response = client.post('/api/regulatory/evaluate/', body, format='json')
    assert response.status_code == 201 and response.data['attempt']['decision'] == 'PASS'
    org = Organisation.objects.create(name='Other', slug='other')
    client.force_authenticate(d['author'])
    foreign = Vehicle.objects.create(organisation=org, plate='FOREIGN')
    assert client.post('/api/regulatory/evidence/', {'evidence_key':'foreign','revision':1,'kind':'VEHICLE_RATING',
        'issuer':'Other','document_ref':'test://foreign','document_sha256':'c'*64,'issued_at':timezone.now().isoformat(),
        'expires_at':(timezone.now()+timedelta(days=1)).isoformat(),'vehicle':foreign.pk}, format='json').status_code == 400


def test_configuration_missing_context_records_review_required(domain):
    d = domain
    entry = QueueEntry.objects.create(organisation=d['org'], facility=d['default_facility'], reg_number='UNKNOWN')
    attempt, _ = s.inspect_entry(d['inspector'], entry, **{**d['inputs'], 'context_id': None, 'client_key':'no-context'})
    assert attempt.decision == 'REVIEW_REQUIRED' and attempt.context_snapshot == {} and attempt.ruleset_snapshot == []


def test_expired_rating_and_inspection_freshness_block_release(domain):
    d = domain
    inspect(d)
    with patch('regulatory.services.timezone.now', return_value=timezone.now()+timedelta(hours=2)):
        with pytest.raises(ReleaseBlocked, match='expired'):
            release_entry(d['entry'].pk, d['ops'])


def test_current_source_revision_and_evidence_requirements_are_enforced(domain):
    d = domain
    snapshots = s.bundles_for(d['context'], timezone.now())
    source = snapshots[0]['content']['units'][0]['source']
    assert source['document_sha256'] == 'b'*64 and source['kind'] == 'INTERNAL_POLICY'
    # Separate document requirement added to a synthetic bundle only.
    from copy import deepcopy
    bundles = deepcopy(snapshots)
    unit = bundles[0]['content']['units'][0]
    unit['definition'] = {'kind':'EVIDENCE','evidence_kind':'DRIVER_LICENCE','subject':'driver',
                          'applicability':{},'failure_action':'HOLD','override_policy':'NOT_ALLOWED'}
    result = evaluate(bundles, s.context_snapshot(d['context'], timezone.now()), {k:v for k,v in d['inputs'].items() if k in ('axle_weights','total_weight','checklist_results')})
    assert result['decision'] == 'HOLD' and not result['override_eligible']


def test_foreign_site_cannot_read_or_override_attempt(domain):
    d = domain
    attempt = inspect(d)
    outsider = get_user_model().objects.create_user(username='outsider')
    other = Organisation.objects.create(name='Other', slug='foreign-org')
    UserProfile.objects.create(user=outsider, organisation=other, role=UserRole.ADMIN)
    client = APIClient()
    client.force_authenticate(outsider)
    assert client.get(f'/api/regulatory/attempts/{attempt.pk}/').status_code == 404
    assert client.get(f'/api/regulatory/queue/{d["entry"].pk}/context/').status_code == 404
    assert client.post(f'/api/regulatory/attempts/{attempt.pk}/override-request/', {'reason':'foreign'}, format='json').status_code == 404


def test_api_registry_creation_and_reviews_cannot_set_verification(domain):
    d = domain
    client = APIClient()
    client.force_authenticate(d['author'])
    body = {key: getattr(d['source'], key).isoformat() if key in ('published_on','effective_from','effective_to') else getattr(d['source'], key)
            for key in ('source_key','revision','title','authority','jurisdiction','kind','tier','provision','document_ref','document_sha256','published_on','effective_from','effective_to')}
    body['source_key'] = 'second-source'
    assert client.post('/api/regulatory/sources/', {**body,'review_status':'VERIFIED'}, format='json').status_code == 400
    created = client.post('/api/regulatory/sources/', body, format='json')
    assert created.status_code == 201 and created.data['record']['review_status'] == 'UNVERIFIED'
    request = {'subject':'source', 'subject_id':created.data['record']['id'], 'approved':True,'reason':'review'}
    assert client.post('/api/regulatory/reviews/', request, format='json').status_code == 409
    client.force_authenticate(d['reviewer'])
    assert client.post('/api/regulatory/reviews/', request, format='json').status_code == 201
    assert client.get('/api/regulatory/sources/').status_code == 200


def test_cross_border_missing_jurisdiction_rules_cannot_pass(domain):
    d = domain
    context = s.create_context(d['inspector'], d['entry'], configuration=d['config'], driver=d['driver'], trip=d['trip'], load=d['load'],
        route_type='CROSS_BORDER', jurisdictions=['TEST','OTHER'], origin='A', destination='B', evidence_ids=[])
    attempt = inspect(d, context_id=context.pk)
    assert attempt.decision == 'REVIEW_REQUIRED'
    with pytest.raises(ValidationError):
        s.request_override(d['ops'], attempt, 'Missing jurisdiction')


def test_api_context_inspection_and_gate_journey(domain):
    d = domain
    client = APIClient()
    client.force_authenticate(d['inspector'])
    path = f'/api/regulatory/queue/{d["entry"].pk}/context/'
    created = client.post(path, {'configuration':d['config'].pk, 'driver':d['driver'].pk, 'trip':d['trip'].pk,
        'load':d['load'].pk, 'route_type':'DOMESTIC','jurisdictions':['TEST'], 'origin':'Synthetic A', 'destination':'Synthetic B', 'evidence_ids':[]}, format='json')
    assert created.status_code == 201
    context = client.get(path)
    assert context.status_code == 200 and context.data['mode'] == 'VERSIONED'
    assert context.data['rulesets'][0]['digest'] == d['ruleset'].digest
    evaluated = client.post('/api/regulatory/evaluate/', {'queue_entry':d['entry'].pk,
        **{**d['inputs'], 'context_id':created.data['context']['id']}}, format='json')
    assert evaluated.status_code == 201 and evaluated.data['attempt']['decision'] == 'PASS'
    client.force_authenticate(d['ops'])
    assert client.post(f'/api/queue/{d["entry"].pk}/release/').status_code == 200
    assert m.ReleaseRecord.objects.get().attempt_id == evaluated.data['attempt']['id']


def test_demo_admin_cannot_destroy_versioned_history(domain):
    d = domain
    d['default_facility'].yard_config = {'mode':'DEMO'}
    d['default_facility'].save()
    inspect(d)
    client = APIClient()
    client.force_authenticate(d['author'])
    for endpoint in ('seed','reset'):
        assert client.post(f'/api/admin/{endpoint}/', {'facility':d['default_facility'].pk}, format='json').status_code == 409
    assert m.InspectionAttempt.objects.count() == 1


@pytest.mark.parametrize('value', ['NaN', 'Infinity', '-1', True])
def test_nonfinite_or_invalid_mass_never_passes(value):
    with pytest.raises(ValueError):
        mass(value)


def test_unknown_rule_language_is_rejected():
    with pytest.raises(ValueError):
        validate_rule({'kind':'PYTHON', 'code':'return True'})
