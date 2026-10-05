"""Negative authority tests and one real demo inspection-to-release journey."""
import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from compliance.policy import MANDATORY_CHECKLIST_IDS
from core.models import Facility
from trip.models import UserProfile, UserRole, Vehicle, Driver
from yard.models import QueueEntry, ComplianceCheck, ComplianceConfig, AuditLog

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def audit_salt(settings):
    settings.AUDIT_SALT = 'integrity-test-only'


def client_for(name, role, org, facility):
    user = get_user_model().objects.create_user(username=name)
    profile = UserProfile.objects.create(user=user, organisation=org, role=role)
    profile.facilities.add(facility)
    client = APIClient()
    client.force_authenticate(user)
    return user, client


@pytest.fixture
def gate(default_org, default_facility):
    dispatch, client = client_for('inspection', UserRole.DISPATCH_SUPERVISOR, default_org, default_facility)
    row = QueueEntry.objects.create(organisation=default_org, facility=default_facility,
                                    reg_number='GATE 100', status='AT_DOCK')
    body = dict(queue_entry=row.pk, axle_weights=[6000,8000,8000], total_weight=22000,
                gvm_rating=24000, checklist_results=dict.fromkeys(MANDATORY_CHECKLIST_IDS, True),
                client_key='inspection-1')
    return dispatch, client, row, body


@pytest.mark.parametrize('from_status,to_status', [
    ('AT_DOCK','COMPLETED'), ('QUARANTINED','PENDING_OVERRIDE'),
    ('PENDING_OVERRIDE','OVERRIDE_APPROVED'), ('OVERRIDE_APPROVED','RELEASED'),
])
def test_generic_patch_cannot_grant_gate_authority(gate, api_client, from_status, to_status):
    _, _, row, _ = gate
    row.status = from_status
    row.save()
    response = api_client.patch(f'/api/queue/{row.pk}/', {'status': to_status}, format='json')
    assert response.status_code == 409
    row.refresh_from_db()
    assert row.status == from_status and row.exit_timestamp is None


def test_caller_limits_rejected_without_writes(gate):
    _, client, row, body = gate
    body.update(limits=[100000]*3, axle_weights=[20000]*3, total_weight=60000, gvm_rating=100000)
    assert client.post('/api/compliance/', body, format='json').status_code == 400
    assert not ComplianceCheck.objects.exists() and not AuditLog.objects.exists()
    row.refresh_from_db()
    assert row.status == 'AT_DOCK'


@pytest.mark.parametrize('answer', [False, None, 1, 'true'])
def test_missing_or_non_boolean_mandatory_checks_block(gate, answer):
    _, client, _, body = gate
    body['checklist_results']['driver-license'] = answer
    response = client.post('/api/compliance/', body, format='json')
    assert response.status_code == 400
    assert 'driver-license' in response.data['missing_checks']
    assert not ComplianceCheck.objects.exists()


def test_omitted_checklist_blocks(gate):
    _, client, _, body = gate
    del body['checklist_results']
    assert client.post('/api/compliance/', body, format='json').status_code == 400


def test_operational_site_cannot_use_pilot_rules_or_release(gate, api_client):
    _, client, row, body = gate
    row.facility.yard_config = {'mode': 'OPERATIONS'}
    row.facility.save()
    response = client.post('/api/compliance/', body, format='json')
    assert response.status_code == 409 and response.data['code'] == 'CONFIGURATION_REQUIRED'
    row.status = 'COMPLETED'
    row.save()
    assert api_client.post(f'/api/queue/{row.pk}/release/').status_code == 409
    assert not ComplianceCheck.objects.exists()


def test_replay_payload_and_actor_are_bound(gate, api_client):
    _, client, _, body = gate
    first = client.post('/api/compliance/', body, format='json')
    assert first.status_code == 201
    replay = client.post('/api/compliance/', body, format='json')
    assert replay.status_code == 200 and replay.data['replayed']
    changed = {**body, 'total_weight': 23000}
    assert client.post('/api/compliance/', changed, format='json').status_code == 409
    # A different dispatch user has access, but cannot own the original key.
    row = gate[2]
    _, other = client_for('other-inspector', UserRole.DISPATCH_SUPERVISOR, row.organisation, row.facility)
    assert other.post('/api/compliance/', body, format='json').status_code == 409
    assert ComplianceCheck.objects.count() == 1


def test_same_key_in_other_facility_never_returns_foreign_check(gate, default_org):
    _, client, _, body = gate
    first = client.post('/api/compliance/', body, format='json')
    facility = Facility.objects.create(organisation=default_org, name='B', slug='b', yard_config={'mode':'DEMO'})
    _, other = client_for('b-inspector', UserRole.DISPATCH_SUPERVISOR, default_org, facility)
    row = QueueEntry.objects.create(organisation=default_org, facility=facility, reg_number='B ONLY')
    second = other.post('/api/compliance/', {**body, 'queue_entry':row.pk}, format='json')
    assert second.status_code == 201
    assert second.data['check']['id'] != first.data['check']['id']
    assert second.data['check']['queue_entry_id'] == row.pk


def test_database_rejects_duplicate_key_in_facility(gate):
    _, client, _, body = gate
    first = client.post('/api/compliance/', body, format='json')
    original = ComplianceCheck.objects.get(pk=first.data['check']['id'])
    with pytest.raises(IntegrityError), transaction.atomic():
        ComplianceCheck.objects.create(organisation=original.organisation, facility=original.facility,
            queue_entry=original.queue_entry, client_key=original.client_key)


def test_stale_override_cannot_replace_new_failure(gate, default_org, default_facility):
    _, client, row, body = gate
    failure = {**body,'axle_weights':[9500,8000,8000], 'total_weight':25500}
    first = client.post('/api/compliance/', failure, format='json')
    _, ops = client_for('requester', UserRole.OPERATIONS_SUPERVISOR, default_org, default_facility)
    check_id = first.data['check']['id']
    assert ops.post(f'/api/compliance/{check_id}/override-request/', {'reason':'review'}, format='json').status_code == 200
    assert client.post('/api/compliance/', {**failure,'client_key':'new-failure'}, format='json').status_code == 201
    _, second_ops = client_for('approver', UserRole.OPERATIONS_SUPERVISOR, default_org, default_facility)
    assert second_ops.post(f'/api/compliance/{check_id}/override-approve/', {'reason':'approved'}, format='json').status_code == 409
    row.refresh_from_db()
    assert row.status == 'QUARANTINED'


def test_demo_failure_independent_override_and_release(gate, default_org, default_facility):
    _, dispatch, row, body = gate
    response = dispatch.post('/api/compliance/', {**body, 'axle_weights':[9500,8000,8000], 'total_weight':25500}, format='json')
    assert response.status_code == 201
    check_id = response.data['check']['id']
    _, requester = client_for('requester', UserRole.OPERATIONS_SUPERVISOR, default_org, default_facility)
    _, approver = client_for('approver', UserRole.OPERATIONS_SUPERVISOR, default_org, default_facility)
    assert requester.post(f'/api/compliance/{check_id}/override-request/', {'reason':'documented demo exception'}, format='json').status_code == 200
    assert requester.post(f'/api/compliance/{check_id}/override-approve/', {'reason':'self'}, format='json').status_code == 400
    assert approver.post(f'/api/compliance/{check_id}/override-approve/', {'reason':'second supervisor reviewed'}, format='json').status_code == 200
    assert approver.post(f'/api/queue/{row.pk}/release/').status_code == 200
    row.refresh_from_db()
    assert row.status == 'RELEASED' and row.exit_timestamp is not None
    event = AuditLog.objects.get(action='RELEASE_VEHICLE')
    assert str(check_id) in event.payload


def test_reset_preserves_shared_configuration(gate, default_org, default_facility):
    config = ComplianceConfig.objects.create(organisation=default_org, axle_limits=[8000,9000,9000])
    _, admin = client_for('admin', UserRole.ADMIN, default_org, default_facility)
    assert admin.post('/api/admin/reset/', {'facility':default_facility.pk}, format='json').status_code == 200
    assert ComplianceConfig.objects.filter(pk=config.pk).exists()


def test_seed_and_reset_refuse_operational_site(gate, default_org, default_facility):
    default_facility.yard_config = {'mode':'OPERATIONS'}
    default_facility.save()
    _, admin = client_for('admin', UserRole.ADMIN, default_org, default_facility)
    for endpoint in ('seed','reset'):
        assert admin.post(f'/api/admin/{endpoint}/', {'facility':default_facility.pk}, format='json').status_code == 409
    assert QueueEntry.objects.filter(pk=gate[2].pk).exists()


@pytest.mark.parametrize('endpoint,body,model', [('vehicles',{'plate':'NO TENANT'},Vehicle), ('drivers',{'name':'No Tenant'},Driver)])
def test_unaffiliated_user_never_writes_first_tenant(default_org, endpoint, body, model):
    user = get_user_model().objects.create_user(username='unaffiliated')
    client = APIClient()
    client.force_authenticate(user)
    before = model.objects.count()
    assert client.post(f'/api/{endpoint}/', body, format='json').status_code in (400,403)
    assert model.objects.count() == before


def test_public_registration_isolated_from_existing_org(default_org):
    response = APIClient().post('/api/auth/register/', {'username':'public-user', 'password':'safe-test-password', 'name':'Public User'}, format='json')
    assert response.status_code == 201
    user = get_user_model().objects.get(username='public-user')
    assert user.profile.organisation_id != default_org.pk
    assert user.profile.role == UserRole.EXECUTIVE
    assert not user.profile.facilities.exists()


def test_inspected_vehicle_identity_cannot_be_edited(gate, api_client):
    _, inspector, row, body = gate
    assert inspector.post('/api/compliance/', body, format='json').status_code == 201
    assert api_client.patch(f'/api/queue/{row.pk}/', {'vehicle_type':'Tanker'}, format='json').status_code == 409
