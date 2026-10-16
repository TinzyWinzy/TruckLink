import pytest
from regulatory.modelling import run_model
from tests.test_auth_tenancy import admin_user, admin_client
from core.models import Facility
from trip.models import Organisation


def test_seed_42_ground_truth_digest_is_pinned():
    # Ground truth for the Phase 1 Markov run_model (yard-synthetic-2).
    # Prior ground truth (yard-synthetic-1, fixed weights): digest
    # cb408883feddf6eac8ce4bcad41b009ebd113518be34d6d3ac197b305ed8368f,
    # serviced 48, blocked 24, wait 0.93, turnaround 12.68, utilisation 70.92.
    # Regenerate only when sampling behaviour intentionally changes, and
    # record the old value here.
    report = run_model(seed=42)
    assert report['result_digest'] == '21b078ee67667c5d5cb87ed8389dbaf96937f186d1796912fedf0b878af4b363'
    assert report['model_version'] == 'yard-synthetic-2'
    assert report['summary']['modelled_serviced'] == 53
    assert report['summary']['blocked'] == 19
    assert report['summary']['average_wait_minutes'] == 3.71
    assert report['summary']['average_turnaround_minutes'] == 15.76
    assert report['summary']['dock_utilisation_percent'] == 84.48
    assert report['summary']['decisions'] == {'HOLD': 8, 'PASS': 47, 'QUARANTINE': 12, 'REVIEW_REQUIRED': 5}
    assert report['summary']['scenario_checks_passed'] == 7


def test_markov_chains_are_well_formed():
    from regulatory.modelling import (DECISION_INITIAL_DISTRIBUTION,
                                      DECISION_TRANSITIONS, RECHECK_TRANSITIONS)
    ids = {'clear', 'overload', 'rating', 'checks', 'measurement', 'rules', 'evidence'}
    assert set(DECISION_INITIAL_DISTRIBUTION) == ids
    assert abs(sum(DECISION_INITIAL_DISTRIBUTION.values()) - 1) < 1e-9
    assert set(DECISION_TRANSITIONS) == ids
    for state, row in DECISION_TRANSITIONS.items():
        assert set(row) <= ids
        assert abs(sum(row.values()) - 1) < 1e-9
        assert DECISION_TRANSITIONS[state].get(state, 0.0) > 0
    # Every HOLD-producing situation has a recheck chain.
    for state, row in RECHECK_TRANSITIONS.items():
        assert state in {'checks', 'measurement', 'evidence'}
        assert set(row) <= ids
        assert abs(sum(row.values()) - 1) < 1e-9


def test_hold_vehicles_may_recheck_once():
    report = run_model(seed=42)
    # With seed 42 the chain produces HOLD situations that re-present.
    assert report['summary']['rechecks_attempted'] > 0
    assert (report['summary']['rechecks_serviced'] + report['summary']['recheck_decisions'].get('HOLD', 0)
            <= report['summary']['rechecks_attempted'])
    assert report['summary']['modelled_serviced'] == (
        sum(1 for r in report['movements'] if r['decision'] == 'PASS')
        + report['summary']['rechecks_serviced'])
    assert all(r['dock'] is None for r in report['rechecks'] if r['decision'] != 'PASS')
    assert all(r['wait_minutes'] >= 0 for r in report['rechecks'] if r['dock'] is not None)
    assert report['summary']['blocked'] == 72 - report['summary']['modelled_serviced']


def test_model_is_reproducible_and_all_cases_match():
    one = run_model(seed=42)
    assert one == run_model(seed=42)
    assert one != run_model(seed=43)
    assert one['summary']['scenario_checks_passed'] == 7
    assert one['verified_law'] is False and one['monetary_penalty'] is None
    assert one['summary']['blocked'] > 0
    assert all(r['dock'] is None for r in one['movements'] if r['decision'] != 'PASS')
    assert not next(s for s in one['scenarios'] if s['id']=='rating')['result']['override_eligible']
    assert next(s for s in one['scenarios'] if s['id']=='overload')['result']['override_eligible']
    assert 0 <= one['summary']['dock_utilisation_percent'] <= 100


def test_capacity_pressure_and_extra_docks_change_waits():
    constrained = run_model(seed=42, docks=1, arrivals_per_hour=120)
    expanded = run_model(seed=42, docks=6, arrivals_per_hour=120)
    assert constrained['summary']['average_wait_minutes'] > expanded['summary']['average_wait_minutes']
    assert constrained['summary']['decisions'] == expanded['summary']['decisions']


@pytest.mark.django_db
def test_model_is_tenant_scoped_and_creates_no_operational_records(admin_client, default_facility):
    from yard.models import QueueEntry
    from regulatory.models import InspectionAttempt, SourceRevision
    counts = [m.objects.count() for m in (QueueEntry,InspectionAttempt,SourceRevision)]
    response = admin_client.post('/api/modelling/run/',{'facility':default_facility.id},format='json')
    assert response.status_code == 200
    assert response.json()['organisation']['id'] == default_facility.organisation_id
    assert [m.objects.count() for m in (QueueEntry,InspectionAttempt,SourceRevision)] == counts
    foreign = Facility.objects.create(organisation=Organisation.objects.create(name='Other tenant',slug='other-model'),name='Foreign',slug='foreign')
    assert admin_client.post('/api/modelling/run/',{'facility':foreign.id},format='json').status_code == 404
    assert admin_client.post('/api/modelling/run/',{'facility':default_facility.id,'vehicles':True},format='json').status_code == 400
    assert admin_client.post('/api/modelling/run/',{'facility':default_facility.id,'vehicles':100000},format='json').status_code == 400


@pytest.mark.django_db
def test_working_dispatch_role_cannot_run_model(admin_client, default_facility, settings):
    settings.AUDIT_SALT = 'synthetic-test-audit-salt'
    assert admin_client.post('/api/auth/switch-role/', {'role': 'DISPATCH_SUPERVISOR'}, format='json').status_code == 200
    assert admin_client.post('/api/modelling/run/', {'facility': default_facility.id}, format='json').status_code == 403
