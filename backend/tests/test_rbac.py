"""B1c: RBAC matrix (golden port of firestore.rules), facility + org scoping."""
from __future__ import annotations

import pytest

from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from core.rbac import rbac_allows
from core.models import Facility
from trip.models import Organisation, Trip, Driver, Vehicle, UserProfile, UserRole
from trip.permissions import scope_facility, in_facility
from yard.models import QueueEntry

User = get_user_model()

ROLES = [
    UserRole.DISPATCH_SUPERVISOR,
    UserRole.OPERATIONS_SUPERVISOR,
    UserRole.FACILITY_MANAGER,
    UserRole.EXECUTIVE,
    UserRole.ADMIN,
    UserRole.COMPLIANCE_OFFICER,
]
ALL = set(ROLES)

# Golden matrix — hand-copied from bak-logistics-app/firestore.rules.
# Deliberately independent of core.rbac.ROLE_MATRIX so drift fails the test.
GOLDEN = {
    ("queue", "read"): ALL,
    ("queue", "create"): {"DISPATCH_SUPERVISOR", "OPERATIONS_SUPERVISOR"},
    ("queue", "update"): {"DISPATCH_SUPERVISOR", "OPERATIONS_SUPERVISOR", "FACILITY_MANAGER"},
    ("queue", "delete"): set(),
    ("compliance", "read"): ALL,
    ("compliance", "create"): {"DISPATCH_SUPERVISOR"},
    ("compliance", "update"): {"OPERATIONS_SUPERVISOR", "ADMIN"},
    ("compliance", "delete"): set(),
    ("docks", "read"): ALL,
    ("docks", "update"): {"OPERATIONS_SUPERVISOR", "FACILITY_MANAGER"},
    ("docks", "create"): {"ADMIN"},
    ("docks", "delete"): {"ADMIN"},
    ("equipment", "read"): ALL,
    ("equipment", "update"): {"OPERATIONS_SUPERVISOR", "FACILITY_MANAGER"},
    ("equipment", "create"): {"ADMIN"},
    ("equipment", "delete"): {"ADMIN"},
    ("alerts", "read"): ALL,
    ("alerts", "create"): {"DISPATCH_SUPERVISOR", "OPERATIONS_SUPERVISOR", "FACILITY_MANAGER"},
    ("alerts", "update"): {"OPERATIONS_SUPERVISOR", "FACILITY_MANAGER", "ADMIN"},
    ("alerts", "delete"): set(),
    ("audit", "read"): {"COMPLIANCE_OFFICER", "ADMIN", "EXECUTIVE", "FACILITY_MANAGER"},
    ("audit", "create"): set(),
    ("audit", "update"): set(),
    ("audit", "delete"): set(),
    ("compliance_config", "read"): ALL,
    ("compliance_config", "create"): {"ADMIN"},
    ("compliance_config", "update"): {"ADMIN"},
    ("compliance_config", "delete"): {"ADMIN"},
    ("reports", "read"): {"OPERATIONS_SUPERVISOR", "FACILITY_MANAGER", "EXECUTIVE", "ADMIN"},
    ("admin", "read"): {"ADMIN"},
    ("admin", "create"): {"ADMIN"},
    ("admin", "update"): {"ADMIN"},
    ("admin", "delete"): {"ADMIN"},
    ("users", "read"): ALL,
    ("users", "create"): {"ADMIN"},
    ("users", "update"): {"ADMIN"},
    ("users", "delete"): set(),
}


@pytest.mark.parametrize(
    "resource,action,role",
    [
        (res, act, role)
        for (res, act), _ in GOLDEN.items()
        for role in [*ROLES, None]
    ],
    ids=lambda v: str(v).replace("UserRole.", ""),
)
def test_matrix_matches_golden(resource, action, role):
    expected = role in GOLDEN[(resource, action)] if role is not None else False
    assert rbac_allows(role, resource, action) is expected


def test_unknown_resource_denied():
    assert rbac_allows("ADMIN", "nonexistent", "read") is False


def test_unknown_action_denied():
    assert rbac_allows("ADMIN", "queue", "approve") is False


# ---------------------------------------------------------------------------
# Facility scoping (SAD §5: scope_facility requires facility ∈ user.facilities)
# ---------------------------------------------------------------------------

@pytest.fixture
def other_facility(default_org):
    return Facility.objects.get_or_create(
        organisation=default_org, slug="other-yard",
        defaults={"name": "Other Yard"},
    )[0]


@pytest.mark.django_db
class TestFacilityScoping:
    def test_member_sees_own_facility_rows(self, auth_user, default_facility, other_facility):
        org = default_org_fixture(default_facility)
        QueueEntry.objects.create(organisation=org, facility=default_facility, reg_number="AAA")
        QueueEntry.objects.create(organisation=org, facility=other_facility, reg_number="BBB")
        scoped = scope_facility(QueueEntry.objects.all(), auth_user)
        assert list(scoped.values_list("reg_number", flat=True)) == ["AAA"]

    def test_user_without_facilities_sees_nothing(self, auth_user, default_facility, other_facility):
        org = default_org_fixture(default_facility)
        QueueEntry.objects.create(organisation=org, facility=default_facility, reg_number="AAA")
        auth_user.profile.facilities.clear()
        assert scope_facility(QueueEntry.objects.all(), auth_user).count() == 0

    def test_in_facility(self, auth_user, default_facility, other_facility):
        assert in_facility(auth_user, default_facility) is True
        assert in_facility(auth_user, other_facility) is False

    def test_anonymous_denied(self, default_facility):
        from django.contrib.auth.models import AnonymousUser
        assert scope_facility(QueueEntry.objects.all(), AnonymousUser()).count() == 0


def default_org_fixture(facility):
    return facility.organisation


# ---------------------------------------------------------------------------
# Cross-organisation negatives (release-blocking: PRD risk R2)
# ---------------------------------------------------------------------------

@pytest.fixture
def other_org_client(db):
    org = Organisation.objects.create(name="Rival Fleet", slug="rival-fleet")
    user = User.objects.create_user(username="rival_ops", password="x")
    UserProfile.objects.create(user=user, organisation=org, role=UserRole.OPERATIONS_SUPERVISOR)
    token, _ = Token.objects.get_or_create(user=user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return client, org


@pytest.mark.django_db
class TestCrossOrganisation:
    def test_foreign_trip_detail_forbidden(self, default_facility, other_org_client):
        client, _ = other_org_client
        trip = Trip.objects.create(
            organisation=default_facility.organisation,
            origin="Harare", destination="Bulawayo",
        )
        resp = client.get(f"/api/trips/{trip.id}/")
        assert resp.status_code == 403

    def test_foreign_driver_detail_forbidden(self, default_facility, other_org_client):
        client, _ = other_org_client
        d = Driver.objects.create(name="Their Driver", organisation=default_facility.organisation)
        resp = client.get(f"/api/drivers/{d.id}/")
        assert resp.status_code == 403

    def test_foreign_vehicle_detail_forbidden(self, default_facility, other_org_client):
        client, _ = other_org_client
        v = Vehicle.objects.create(plate="THEM01", organisation=default_facility.organisation)
        resp = client.get(f"/api/vehicles/{v.id}/")
        assert resp.status_code == 403

    def test_driver_list_excludes_foreign_org(self, default_facility, other_org_client):
        client, _ = other_org_client
        Driver.objects.create(name="Hidden", organisation=default_facility.organisation)
        resp = client.get("/api/drivers/")
        assert resp.status_code == 200
        assert resp.json()["drivers"] == []

    def test_vehicle_create_lands_in_own_org_only(self, default_facility, other_org_client):
        client, org = other_org_client
        resp = client.post("/api/vehicles/", {"plate": "XTRA01"}, format="json")
        assert resp.status_code == 201
        v = Vehicle.objects.get(plate="XTRA01")
        assert v.organisation_id == org.id  # own org only, never the other one


@pytest.mark.django_db
class TestStaffBypassRemoved:
    """SAD §5: is_staff grants nothing; the ADMIN role replaces it."""

    def test_is_staff_without_profile_denied_admin_metrics(self, db):
        user = User.objects.create_user(username="staff_only", password="x", is_staff=True)
        token, _ = Token.objects.get_or_create(user=user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        assert client.get("/api/admin/metrics/").status_code == 403

    def test_is_staff_non_admin_role_denied_admin_metrics(self, db):
        from core.models import Facility as _Facility
        org = Organisation.objects.create(name="F", slug="f-org")
        user = User.objects.create_user(username="staff_ops", password="x", is_staff=True)
        fac = _Facility.objects.create(organisation=org, name="Y", slug="y")
        p = UserProfile.objects.create(user=user, organisation=org, role=UserRole.OPERATIONS_SUPERVISOR)
        p.facilities.add(fac)
        token, _ = Token.objects.get_or_create(user=user)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        assert client.get("/api/admin/metrics/").status_code == 403

    def test_is_staff_flag_grants_no_cross_org_read(self, default_facility, other_org_client):
        """is_staff on a rival-org user must not expose our rows."""
        client, org = other_org_client
        rival_user = User.objects.get(username="rival_ops")
        rival_user.is_staff = True
        rival_user.save(update_fields=["is_staff"])
        Driver.objects.create(name="Ours", organisation=default_facility.organisation)
        resp = client.get("/api/drivers/")
        assert resp.status_code == 200
        assert resp.json()["drivers"] == []
