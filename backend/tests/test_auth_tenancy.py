"""B1c: auth flows — PIN login, admin provisioning, tenancy signup, /me."""
from __future__ import annotations

import pytest

from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from core.models import Facility, PinCredential
from trip.models import Organisation, UserProfile, UserRole

User = get_user_model()


@pytest.fixture
def admin_user(default_org, default_facility):
    user, _ = User.objects.get_or_create(username="plant_admin")
    user.set_password("admin-pass-123")
    user.save()
    profile, _ = UserProfile.objects.get_or_create(
        user=user, defaults={"organisation": default_org, "role": UserRole.ADMIN},
    )
    profile.organisation = default_org
    profile.role = UserRole.ADMIN
    profile.save(update_fields=["organisation", "role"])
    profile.facilities.add(default_facility)
    return user


@pytest.fixture
def admin_client(admin_user):
    client = APIClient()
    token, _ = Token.objects.get_or_create(user=admin_user)
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return client


def _provision(admin_client, default_facility, **overrides):
    payload = {
        "staff_id": "0007",
        "pin": "1234",
        "role": UserRole.OPERATIONS_SUPERVISOR,
        "facility_id": default_facility.id,
    }
    payload.update(overrides)
    return admin_client.post("/api/admin/pins/", payload, format="json")


@pytest.mark.django_db
class TestPinLogin:
    def test_provision_then_pin_login(self, admin_client, default_facility, anon_client):
        resp = _provision(admin_client, default_facility)
        assert resp.status_code == 201
        assert resp.json()["pin"]["staff_id"] == "TRK-0007"

        resp = anon_client.post(
            "/api/auth/pin/", {"staff_id": "TRK-0007", "pin": "1234"}, format="json",
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["token"]
        assert data["user"]["role"] == UserRole.OPERATIONS_SUPERVISOR
        assert [f["slug"] for f in data["user"]["facilities"]] == ["main-yard"]

        me = APIClient()
        me.credentials(HTTP_AUTHORIZATION=f"Token {data['token']}")
        resp = me.get("/api/auth/me/")
        assert resp.status_code == 200
        assert resp.json()["user"]["role"] == UserRole.OPERATIONS_SUPERVISOR

    def test_pin_login_accepts_bare_staff_id(self, admin_client, default_facility, anon_client):
        _provision(admin_client, default_facility, staff_id="1234")
        resp = anon_client.post(
            "/api/auth/pin/", {"staff_id": "1234", "pin": "1234"}, format="json",
        )
        assert resp.status_code == 200
        assert PinCredential.objects.filter(staff_id="TRK-1234").exists()

    @pytest.mark.parametrize("bad_pin", ["0000", "12345", ""])
    def test_wrong_pin_401(self, admin_client, default_facility, anon_client, bad_pin):
        _provision(admin_client, default_facility)
        resp = anon_client.post(
            "/api/auth/pin/", {"staff_id": "TRK-0007", "pin": bad_pin}, format="json",
        )
        assert resp.status_code == 401

    def test_unknown_staff_id_401(self, anon_client):
        resp = anon_client.post(
            "/api/auth/pin/", {"staff_id": "TRK-9999", "pin": "1234"}, format="json",
        )
        assert resp.status_code == 401
        assert resp.json()["error"] == "invalid credentials"

    def test_inactive_credential_401(self, admin_client, default_facility, anon_client):
        _provision(admin_client, default_facility)
        cred = PinCredential.objects.get(staff_id="TRK-0007")
        cred.is_active = False
        cred.save(update_fields=["is_active"])
        resp = anon_client.post(
            "/api/auth/pin/", {"staff_id": "TRK-0007", "pin": "1234"}, format="json",
        )
        assert resp.status_code == 401

    def test_credential_without_user_401(self, default_org, anon_client):
        """Synthetic user creation is admin-only — a userless credential never logs in."""
        from django.contrib.auth.hashers import make_password
        PinCredential.objects.create(
            staff_id="TRK-5555", pin_hash=make_password("1234"),
            organisation=default_org, user=None,
        )
        resp = anon_client.post(
            "/api/auth/pin/", {"staff_id": "TRK-5555", "pin": "1234"}, format="json",
        )
        assert resp.status_code == 401

    def test_missing_fields_401(self, anon_client):
        assert anon_client.post("/api/auth/pin/", {}, format="json").status_code == 401


@pytest.mark.django_db
class TestProvisionPin:
    def test_requires_auth(self, anon_client, default_facility):
        resp = anon_client.post("/api/admin/pins/", {"staff_id": "1", "pin": "1234"}, format="json")
        assert resp.status_code == 401

    def test_requires_admin_role(self, api_client, default_facility):
        """api_client is OPERATIONS_SUPERVISOR — provisioning is ADMIN-only."""
        resp = _provision(api_client, default_facility)
        assert resp.status_code == 403

    def test_duplicate_staff_id_400(self, admin_client, default_facility):
        _provision(admin_client, default_facility)
        resp = _provision(admin_client, default_facility)
        assert resp.status_code == 400
        assert "staff_id" in resp.json()["errors"]

    def test_short_pin_400(self, admin_client, default_facility):
        resp = _provision(admin_client, default_facility, pin="12")
        assert resp.status_code == 400
        assert "pin" in resp.json()["errors"]

    def test_unknown_role_400(self, admin_client, default_facility):
        resp = _provision(admin_client, default_facility, role="SUPERVISOR")
        assert resp.status_code == 400
        assert "role" in resp.json()["errors"]

    def test_facility_outside_admin_org_400(self, admin_client, db):
        other_org = Organisation.objects.create(name="Other", slug="other-org")
        foreign_fac = Facility.objects.create(organisation=other_org, name="F", slug="f")
        resp = _provision(admin_client, foreign_fac)
        assert resp.status_code == 400
        assert "facility_id" in resp.json()["errors"]


@pytest.mark.django_db
class TestTenancySignup:
    PAYLOAD = {
        "organisation_name": "Zim Hauliers",
        "facility_name": "Msasa Yard",
        "username": "zim_admin",
        "password": "secret123",
        "email": "ops@zimhauliers.co.zw",
    }

    def test_signup_creates_org_facility_admin(self, anon_client):
        resp = anon_client.post("/api/tenancy/signup/", self.PAYLOAD, format="json")
        assert resp.status_code == 201
        data = resp.json()
        assert data["organisation"]["slug"] == "zim-hauliers"
        assert data["facility"]["slug"] == "msasa-yard"
        assert data["user"]["role"] == UserRole.ADMIN
        assert data["token"]

        me = APIClient()
        me.credentials(HTTP_AUTHORIZATION=f"Token {data['token']}")
        resp = me.get("/api/auth/me/")
        user = resp.json()["user"]
        assert user["role"] == UserRole.ADMIN
        assert user["is_admin"] is True
        assert [f["slug"] for f in user["facilities"]] == ["msasa-yard"]
        assert Organisation.objects.filter(slug="zim-hauliers").exists()

    def test_signup_duplicate_slug_400(self, anon_client):
        assert anon_client.post("/api/tenancy/signup/", self.PAYLOAD, format="json").status_code == 201
        resp = anon_client.post("/api/tenancy/signup/", self.PAYLOAD, format="json")
        assert resp.status_code == 400

    def test_signup_short_password_400(self, anon_client):
        payload = {**self.PAYLOAD, "password": "123"}
        resp = anon_client.post("/api/tenancy/signup/", payload, format="json")
        assert resp.status_code == 400
        assert "password" in resp.json()["errors"]

    def test_signup_duplicate_username_400(self, anon_client, auth_user):
        resp = anon_client.post(
            "/api/tenancy/signup/", {**self.PAYLOAD, "username": "ops"}, format="json",
        )
        assert resp.status_code == 400
        assert "username" in resp.json()["errors"]

    def test_signup_missing_org_400(self, anon_client):
        payload = {**self.PAYLOAD, "organisation_name": ""}
        resp = anon_client.post("/api/tenancy/signup/", payload, format="json")
        assert resp.status_code == 400
        assert "organisation_name" in resp.json()["errors"]


@pytest.mark.django_db
class TestMe:
    def test_me_returns_role_org_facilities(self, api_client):
        resp = api_client.get("/api/auth/me/")
        assert resp.status_code == 200
        user = resp.json()["user"]
        assert user["role"] == UserRole.OPERATIONS_SUPERVISOR
        assert user["is_admin"] is False
        assert user["organisation"]["slug"] == "default"
        assert [f["slug"] for f in user["facilities"]] == ["main-yard"]

    def test_me_requires_auth(self, anon_client):
        assert anon_client.get("/api/auth/me/").status_code == 401
