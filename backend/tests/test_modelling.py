import pytest
from regulatory.modelling import run_model
from tests.test_auth_tenancy import admin_user, admin_client
from core.models import Facility
from trip.models import Organisation


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
