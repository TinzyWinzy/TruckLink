import time
import pytest
from django.core.cache import cache
from core.throttling import CredentialAttemptThrottle, CredentialIPThrottle
from tests.test_auth_tenancy import admin_user, admin_client


@pytest.mark.django_db
def test_exhausted_old_hourly_budget_does_not_block_operations(admin_user, admin_client):
    cache.set(f'throttle_user_{admin_user.pk}', [time.time()] * 120, 3600)
    for _ in range(125):
        assert admin_client.get('/api/auth/me/').status_code == 200


@pytest.mark.django_db
def test_pin_attempts_have_a_separate_shared_credential_budget(anon_client, monkeypatch):
    monkeypatch.setattr(CredentialIPThrottle, 'rate', '2/minute', raising=False)
    for _ in range(2):
        assert anon_client.post('/api/auth/pin/', {'staff_id':'TRK-NONEXISTENT','pin':'0000'}, format='json').status_code == 401
    blocked = anon_client.post('/api/auth/login/', {'username':'missing','password':'incorrect'}, format='json')
    assert blocked.status_code == 429
    assert int(blocked['Retry-After']) > 0


@pytest.mark.django_db
def test_pin_identity_budget_survives_ip_changes_and_staff_id_formatting(anon_client, monkeypatch):
    monkeypatch.setattr(CredentialAttemptThrottle, 'rate', '2/minute', raising=False)
    for ip in ['192.0.2.1', '192.0.2.2']:
        assert anon_client.post('/api/auth/pin/', {'staff_id':'TRK-MISSING','pin':'0000'}, format='json', REMOTE_ADDR=ip).status_code == 401
    assert anon_client.post('/api/auth/pin/', {'staff_id':' missing ','pin':'0000'}, format='json', REMOTE_ADDR='192.0.2.3').status_code == 429
