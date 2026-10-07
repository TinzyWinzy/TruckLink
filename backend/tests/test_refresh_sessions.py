from datetime import timedelta
import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.authtoken.models import Token
from core.models import RefreshSession, AdminRoleSelection, PinCredential
from core.sessions import issue_session
from django.contrib.auth.hashers import make_password
from trip.models import Organisation

pytestmark = pytest.mark.django_db


def account():
    return get_user_model().objects.create_user(username='renew-test', password='synthetic-password')


def test_credentials_ignore_invalid_authorization_for_password_and_pin():
    user = account()
    org = Organisation.objects.create(name='Renew test',slug='renew-test')
    PinCredential.objects.create(staff_id='TRK-RENEW', user=user, organisation=org, pin_hash=make_password('123456'))
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION='Token stale-token')
    for path, body in [('/api/auth/login/', {'username':user.username,'password':'synthetic-password'}),
                       ('/api/auth/pin/', {'staff_id':'TRK-RENEW','pin':'123456'})]:
        result = c.post(path, body, format='json')
        assert result.status_code == 200
        assert result.data['refresh_token']
        assert not RefreshSession.objects.filter(secret_hash=result.data['refresh_token']).exists()


def test_expired_access_renews_and_preserves_working_role_then_logout_revokes():
    user = account()
    credentials = issue_session(user)
    token = Token.objects.get(user=user)
    AdminRoleSelection.objects.create(token=token, role='DISPATCH_SUPERVISOR')
    Token.objects.filter(pk=token.pk).update(created=timezone.now()-timedelta(hours=1))
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')
    assert c.get('/api/auth/me/').status_code == 401
    result = c.post('/api/auth/refresh/', {'refresh_token':credentials['refresh_token']}, format='json')
    assert result.status_code == 200
    assert result.data['token'] != token.key
    assert AdminRoleSelection.objects.get(token_id=result.data['token']).role == 'DISPATCH_SUPERVISOR'
    c.credentials(HTTP_AUTHORIZATION=f"Token {result.data['token']}")
    assert c.get('/api/auth/me/').status_code == 200
    assert c.post('/api/auth/logout/').status_code == 200
    assert c.post('/api/auth/refresh/', {'refresh_token':credentials['refresh_token']}, format='json').status_code == 401


@pytest.mark.parametrize('condition', ['expired','disabled','password','pin','revoked','invalid'])
def test_refresh_fails_closed(condition):
    user = account()
    credentials = issue_session(user)
    if condition == 'expired': RefreshSession.objects.update(expires_at=timezone.now()-timedelta(seconds=1))
    if condition == 'disabled': user.is_active=False; user.save()
    if condition == 'password': user.set_password('replacement'); user.save()
    if condition == 'pin':
        org = Organisation.objects.create(name='Renew test',slug='renew-test')
        PinCredential.objects.create(staff_id='TRK-CHANGE', user=user, organisation=org, pin_hash=make_password('1234'))
    if condition == 'revoked': Token.objects.filter(user=user).delete()
    if condition == 'invalid': credentials['refresh_token']='unrecognized-secret-'*3
    assert APIClient().post('/api/auth/refresh/', {'refresh_token':credentials['refresh_token']}, format='json').status_code == 401
