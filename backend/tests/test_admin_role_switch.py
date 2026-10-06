import pytest
from rest_framework.test import APIClient
from core.models import AdminRoleSelection
from trip.models import UserRole, UserProfile
from tests.test_auth_tenancy import admin_user, admin_client

pytestmark = pytest.mark.django_db


def test_admin_working_role_is_enforced_and_reversible(admin_client, admin_user, default_facility, settings):
    settings.AUDIT_SALT = 'test-switch-audit'
    identity = admin_user.pk
    r = admin_client.post('/api/auth/switch-role/', {'role': 'EXECUTIVE'}, format='json')
    assert r.status_code == 200
    assert r.json()['user']['role'] == 'EXECUTIVE'
    assert r.json()['user']['base_role'] == 'ADMIN'
    assert r.json()['user']['id'] == identity
    assert admin_client.get('/api/auth/me/').json()['user']['role'] == 'EXECUTIVE'
    assert admin_client.post('/api/admin/pins/', {'staff_id': 'forbidden', 'pin': '1234'}, format='json').status_code == 403
    r = admin_client.post('/api/auth/switch-role/', {'role': 'ADMIN'}, format='json')
    assert r.status_code == 200
    assert r.json()['user']['role'] == 'ADMIN'
    assert UserProfile.objects.get(user=admin_user).role == UserRole.ADMIN
    from yard.models import AuditLog
    assert AuditLog.objects.filter(facility=default_facility, action='ADMIN_ROLE_SWITCH', actor_id=identity).count() == 2


def test_nonadmin_cannot_switch_even_with_forged_base_role(admin_client, admin_user):
    admin_user.profile.role = UserRole.DISPATCH_SUPERVISOR
    admin_user.profile.save()
    r = admin_client.post('/api/auth/switch-role/', {'role': 'ADMIN', 'base_role': 'ADMIN'}, format='json')
    assert r.status_code == 403
    assert not AdminRoleSelection.objects.exists()


def test_invalid_role_rejected_and_new_login_resets_selection(admin_client, admin_user, settings):
    settings.AUDIT_SALT = 'test-switch-audit'
    assert admin_client.post('/api/auth/switch-role/', {'role': 'ROOT'}, format='json').status_code == 400
    assert admin_client.post('/api/auth/switch-role/', {'role': 'DISPATCH_SUPERVISOR'}, format='json').status_code == 200
    login = APIClient().post('/api/auth/login/', {'username': admin_user.username, 'password': 'admin-pass-123'}, format='json')
    assert login.status_code == 200
    assert login.json()['user']['role'] == 'ADMIN'
    assert not AdminRoleSelection.objects.exists()


def test_demoted_administrator_cannot_use_stored_admin_role(admin_client, admin_user, settings):
    settings.AUDIT_SALT = 'test-switch-audit'
    admin_client.post('/api/auth/switch-role/', {'role': 'ADMIN'}, format='json')
    profile = UserProfile.objects.get(user=admin_user)
    profile.role = UserRole.EXECUTIVE
    profile.save()
    assert admin_client.get('/api/auth/me/').json()['user']['role'] == 'EXECUTIVE'
    assert admin_client.post('/api/auth/switch-role/', {'role': 'ADMIN'}, format='json').status_code == 403


def test_missing_audit_salt_does_not_change_selected_role(admin_client, settings):
    settings.AUDIT_SALT = ''
    from core.audit import AuditSaltMissing
    with pytest.raises(AuditSaltMissing):
        admin_client.post('/api/auth/switch-role/', {'role': 'EXECUTIVE'}, format='json')
    assert not AdminRoleSelection.objects.exists()
