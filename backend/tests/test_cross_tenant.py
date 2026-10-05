"""B6: cross-tenant negative matrix (SAD §14 — release-blocking).

Org B operators hold roles that PASS the RBAC matrix for each endpoint, so a
404/400 here proves tenancy isolation, not a role gate. A positive control
proves the same clients work against their own facility (no false-green).
"""
from __future__ import annotations

import pytest

from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from core.models import Facility, PinCredential
from trip.models import Organisation, UserProfile, UserRole
from yard.models import Alert, ComplianceCheck, Dock, QueueEntry

User = get_user_model()

# Org A marker: must never appear in any org B response body.
SECRET_REG = "TNT 7788"


@pytest.fixture(autouse=True)
def audit_salt(settings):
    settings.AUDIT_SALT = "test-only-salt"
    return settings.AUDIT_SALT


def _client_for(username, role, org, facility):
    user = User.objects.create_user(username=username, password="x")
    profile = UserProfile.objects.create(user=user, organisation=org, role=role)
    profile.facilities.add(facility)
    token, _ = Token.objects.get_or_create(user=user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return user, client


@pytest.fixture
def org_b(db):
    org = Organisation.objects.create(name="Other Fleet", slug="other-fleet")
    fac = Facility.objects.create(
        organisation=org, name="Other Yard", slug="other-yard", yard_config={"mode": "DEMO"},
    )
    return org, fac


@pytest.fixture
def b_dispatch(org_b):
    org, fac = org_b
    return _client_for(
        "b-dispatch", UserRole.DISPATCH_SUPERVISOR, org, fac,
    )[1]


@pytest.fixture
def b_ops(org_b):
    org, fac = org_b
    return _client_for(
        "b-ops", UserRole.OPERATIONS_SUPERVISOR, org, fac,
    )[1]


@pytest.fixture
def b_admin(org_b):
    org, fac = org_b
    return _client_for("b-admin", UserRole.ADMIN, org, fac)[1]


@pytest.fixture
def b_compliance(org_b):
    org, fac = org_b
    return _client_for(
        "b-compliance", UserRole.COMPLIANCE_OFFICER, org, fac,
    )[1]


@pytest.fixture
def org_a_entry(default_org, default_facility, auth_user):
    return QueueEntry.objects.create(
        organisation=default_org,
        facility=default_facility,
        reg_number=SECRET_REG,
        vehicle_type="DRY_VAN",
        status="QUEUED",
        created_by=auth_user,
    )


@pytest.fixture
def org_a_dock(default_org, default_facility):
    return Dock.objects.create(
        organisation=default_org,
        facility=default_facility,
        name="Alpha Dock",
        status="AVAILABLE",
    )


@pytest.fixture
def org_a_alert(default_org, default_facility, org_a_entry):
    return Alert.objects.create(
        organisation=default_org,
        facility=default_facility,
        severity="HIGH",
        category="EXCESSIVE_WAIT",
        message="Org A only alert",
        related_queue_entry=org_a_entry,
    )


def _assert_no_leak(resp, status_expected=(400, 403, 404)):
    assert resp.status_code in status_expected, (
        f"expected {status_expected}, got {resp.status_code}: {resp.content[:300]!r}"
    )
    assert SECRET_REG not in resp.content.decode(errors="ignore")


# ---------------------------------------------------------------------------
# Reads scoped by ?facility= (org A slug or pk)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestReadScoping:
    def test_yard_board_foreign_404(self, b_dispatch, default_facility):
        _assert_no_leak(
            b_dispatch.get("/api/yard/board/", {"facility": default_facility.slug}),
        )

    def test_queue_list_foreign_404(self, b_dispatch, default_facility):
        _assert_no_leak(
            b_dispatch.get("/api/queue/", {"facility": default_facility.slug}),
        )

    def test_docks_list_foreign_404(self, b_dispatch, default_facility):
        _assert_no_leak(
            b_dispatch.get("/api/docks/", {"facility": default_facility.slug}),
        )

    def test_alerts_list_foreign_404(self, b_dispatch, default_facility):
        _assert_no_leak(
            b_dispatch.get("/api/alerts/", {"facility": default_facility.slug}),
        )

    def test_compliance_list_foreign_404(self, b_dispatch, default_facility):
        _assert_no_leak(
            b_dispatch.get("/api/compliance/", {"facility": default_facility.slug}),
        )

    def test_reports_foreign_404(self, b_ops, default_facility):
        _assert_no_leak(
            b_ops.get("/api/reports/turnaround/", {"facility": default_facility.slug}),
        )

    def test_report_export_foreign_404(self, b_ops, default_facility):
        _assert_no_leak(
            b_ops.get("/api/reports/export.csv", {"facility": default_facility.slug}),
        )

    def test_audit_surface_foreign_404(self, b_compliance, default_facility):
        for path in ("/api/audit/", "/api/audit/verify/", "/api/audit/export.csv"):
            _assert_no_leak(b_compliance.get(path, {"facility": default_facility.id}))


# ---------------------------------------------------------------------------
# Writes against org A objects
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestWriteScoping:
    def test_queue_create_foreign_404_no_row(
        self, b_dispatch, default_facility,
    ):
        before = QueueEntry.objects.count()
        resp = b_dispatch.post(
            "/api/queue/",
            {
                "facility": default_facility.slug,
                "reg_number": SECRET_REG,
                "driver_name": "Intruder",
            },
            format="json",
        )
        _assert_no_leak(resp)
        assert QueueEntry.objects.count() == before

    def test_compliance_submit_foreign_entry_404_no_check(
        self, b_dispatch, org_a_entry,
    ):
        resp = b_dispatch.post(
            "/api/compliance/",
            {
                "queue_entry": org_a_entry.id,
                "axle_weights": [6000, 8000, 8000],
                "total_weight": 22000,
                "gvm_rating": 24000,
            },
            format="json",
        )
        _assert_no_leak(resp)
        assert ComplianceCheck.objects.count() == 0
        org_a_entry.refresh_from_db()
        assert org_a_entry.status == "QUEUED"

    def test_dock_create_foreign_404_no_row(self, b_admin, default_facility):
        before = Dock.objects.count()
        resp = b_admin.post(
            "/api/docks/",
            {"facility": default_facility.slug, "name": "Intruder Dock"},
            format="json",
        )
        _assert_no_leak(resp)
        assert Dock.objects.count() == before

    def test_queue_patch_foreign_404_status_unchanged(self, b_ops, org_a_entry):
        resp = b_ops.patch(
            f"/api/queue/{org_a_entry.id}/", {"status": "ASSIGNED"}, format="json",
        )
        _assert_no_leak(resp)
        org_a_entry.refresh_from_db()
        assert org_a_entry.status == "QUEUED"

    def test_release_foreign_404_status_unchanged(self, b_ops, org_a_entry):
        resp = b_ops.post(f"/api/queue/{org_a_entry.id}/release/")
        _assert_no_leak(resp)
        org_a_entry.refresh_from_db()
        assert org_a_entry.status == "QUEUED"
        assert org_a_entry.exit_timestamp is None

    def test_dock_assign_foreign_404(self, b_ops, org_a_entry, org_a_dock):
        resp = b_ops.post(
            f"/api/docks/{org_a_dock.id}/assign/",
            {"queue_entry": org_a_entry.id},
            format="json",
        )
        _assert_no_leak(resp)
        org_a_dock.refresh_from_db()
        assert org_a_dock.status == "AVAILABLE"
        assert org_a_dock.current_entry_id is None

    def test_alert_ack_foreign_404_stays_unacked(self, b_ops, org_a_alert):
        resp = b_ops.post(f"/api/alerts/{org_a_alert.id}/ack/")
        _assert_no_leak(resp)
        org_a_alert.refresh_from_db()
        assert org_a_alert.acknowledged is False

    def test_seed_foreign_404_no_rows(self, b_admin, default_facility):
        before = {
            "docks": Dock.objects.count(),
            "queue": QueueEntry.objects.count(),
            "alerts": Alert.objects.count(),
        }
        resp = b_admin.post(
            "/api/admin/seed/", {"facility": default_facility.slug}, format="json",
        )
        _assert_no_leak(resp)
        assert Dock.objects.count() == before["docks"]
        assert QueueEntry.objects.count() == before["queue"]
        assert Alert.objects.count() == before["alerts"]

    def test_reset_foreign_404_rows_intact(self, b_admin, default_facility, org_a_entry):
        resp = b_admin.post(
            "/api/admin/reset/", {"facility": default_facility.slug}, format="json",
        )
        _assert_no_leak(resp)
        assert QueueEntry.objects.filter(pk=org_a_entry.pk).exists()

    def test_pin_provision_foreign_facility_400_no_pin(self, b_admin, default_facility):
        resp = b_admin.post(
            "/api/admin/pins/",
            {
                "staff_id": "TRK-B-9999",
                "pin": "9999",
                "role": "DISPATCH_SUPERVISOR",
                "facility_id": default_facility.id,
            },
            format="json",
        )
        _assert_no_leak(resp)
        assert not PinCredential.objects.filter(staff_id="TRK-B-9999").exists()


# ---------------------------------------------------------------------------
# Positive control: the same clients work on their OWN facility (so the
# 404s above are proven tenancy isolation, not broken auth plumbing).
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestPositiveControl:
    def test_dispatch_reads_and_writes_own_facility(self, b_dispatch, org_b):
        _, fac_b = org_b
        board = b_dispatch.get("/api/yard/board/", {"facility": fac_b.slug})
        assert board.status_code == 200
        created = b_dispatch.post(
            "/api/queue/",
            {"facility": fac_b.slug, "reg_number": "BIZ 0001", "driver_name": "Ours"},
            format="json",
        )
        assert created.status_code == 201

    def test_admin_seeds_own_facility(self, b_admin, org_b):
        _, fac_b = org_b
        resp = b_admin.post(
            "/api/admin/seed/", {"facility": fac_b.slug}, format="json",
        )
        assert resp.status_code == 200
        assert Dock.objects.filter(facility=fac_b).exists()
