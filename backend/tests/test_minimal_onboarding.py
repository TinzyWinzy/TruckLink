"""Synthetic tenant bootstrap: minimal identity, atomic ownership and closed operations."""
from unittest.mock import patch
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password
from django.db import IntegrityError
from rest_framework.test import APIClient
from core.models import Facility, PinCredential
from trip.models import Organisation
from tenancy.configuration import resolved
from yard.models import AuditLog

pytestmark = pytest.mark.django_db
PAYLOAD = {'organisation_name':'Synthetic Onboarding Tenant','staff_id':'TRK-SYNTH-ADMIN',
    'pin':'93472581','onboarding_workspace':True,'facility_timezone':'Africa/Harare'}


def test_single_admin_without_personal_profile_and_scoped_renewable_access(settings):
    settings.AUDIT_SALT = 'synthetic-onboarding-audit'
    response = APIClient().post('/api/tenancy/signup/',PAYLOAD,format='json')
    assert response.status_code == 201
    data = response.json()
    user = get_user_model().objects.get(pk=data['user']['id'])
    assert get_user_model().objects.count() == 1
    assert user.username == PAYLOAD['staff_id']
    assert (user.email,user.first_name,user.last_name) == ('','','')
    assert not user.has_usable_password() and not user.is_staff and not user.is_superuser
    pin = PinCredential.objects.get(user=user)
    site = Facility.objects.get(pk=data['facility']['id'])
    assert pin.organisation_id == site.organisation_id == user.profile.organisation_id
    assert pin.facility == site and check_password(PAYLOAD['pin'],pin.pin_hash)
    assert site.name == 'Onboarding workspace' and site.yard_config == {'mode':'OPERATIONS','onboarding':True}
    assert site.timezone == 'Africa/Harare'
    assert user.profile.role == 'ADMIN' and list(user.profile.facilities.all()) == [site]
    assert site.organisation.requires_release
    config = resolved(site.organisation)
    assert config['release'] is None and all(value == (key == 'audit') for key,value in config['modules'].items())
    assert config['content']['branding']['display_name'] == PAYLOAD['organisation_name']
    audit = AuditLog.objects.get(action='CREATE_TENANT')
    assert audit.actor_id == user.pk and PAYLOAD['pin'] not in audit.payload
    assert data['refresh_token'] and data['expires_in'] == 1800
    client = APIClient(); client.credentials(HTTP_AUTHORIZATION=f"Token {data['token']}")
    assert client.get('/api/auth/me/').json()['user']['organisation']['id'] == site.organisation_id
    assert client.post('/api/queue/',{'facility':site.pk,'reg_number':'SYNTHETIC'},format='json').status_code == 403
    assert client.post('/api/docks/',{'facility':site.pk,'name':'Synthetic Dock'},format='json').status_code == 403
    login = APIClient().post('/api/auth/pin/',{'staff_id':PAYLOAD['staff_id'],'pin':PAYLOAD['pin']},format='json')
    assert login.status_code == 200 and login.json()['user']['id'] == user.pk


@pytest.mark.parametrize('extra', [
    {'pin':'1234'}, {'pin':'1234567890123'}, {'pin':'abcdef'}, {'staff_id':'bad id'},
    {'email':'synthetic@example.test'}, {'national_id':'synthetic'}, {'password':'synthetic'},
    {'facility_timezone':'not/a-timezone'}, {'onboarding_workspace':'true'},
])
def test_invalid_or_excessive_data_leaves_no_tenant(extra):
    response = APIClient().post('/api/tenancy/signup/',{**PAYLOAD,**extra},format='json')
    assert response.status_code == 400
    assert not Organisation.objects.exists() and not get_user_model().objects.exists()


def test_duplicate_and_cross_tenant_access_are_rejected(settings):
    settings.AUDIT_SALT = 'synthetic-onboarding-audit'
    client = APIClient()
    first = client.post('/api/tenancy/signup/',PAYLOAD,format='json').json()
    duplicate = client.post('/api/tenancy/signup/',{**PAYLOAD,'organisation_name':'Synthetic Other'},format='json')
    assert duplicate.status_code == 400 and Organisation.objects.count() == 1
    second = client.post('/api/tenancy/signup/',{**PAYLOAD,'organisation_name':'Synthetic Other','staff_id':'TRK-SYNTH-OTHER'},format='json').json()
    client.credentials(HTTP_AUTHORIZATION=f"Token {second['token']}")
    assert client.get(f"/api/audit/?facility={first['facility']['id']}").status_code == 404


def test_failed_credential_write_rolls_back_everything():
    with patch('core.views.PinCredential.objects.create',side_effect=IntegrityError('Synthetic collision')):
        response = APIClient().post('/api/tenancy/signup/',PAYLOAD,format='json')
    assert response.status_code == 409
    assert not Organisation.objects.exists() and not get_user_model().objects.exists()


def test_failed_audit_rolls_back_everything():
    with patch('core.audit.append_audit',side_effect=RuntimeError('Synthetic audit outage')):
        with pytest.raises(RuntimeError):
            APIClient().post('/api/tenancy/signup/',PAYLOAD,format='json')
    assert not Organisation.objects.exists() and not PinCredential.objects.exists()
