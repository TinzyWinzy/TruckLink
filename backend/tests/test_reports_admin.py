"""B1g: reports, compliance config read, admin demo seed/reset (SAD v2 section 11)."""
from __future__ import annotations

from datetime import timedelta

import pytest

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from core.audit import verify_chain
from core.models import Facility
from trip.models import Organisation, UserProfile, UserRole
from yard.models import Alert, Dock, Equipment, QueueEntry
from yard.reports import compute_turnaround_stats

User = get_user_model()


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
def admin_client(default_org, default_facility):
    _, client = _client_for("admin_user", UserRole.ADMIN, default_org, default_facility)
    return client


@pytest.fixture
def exec_client(default_org, default_facility):
    _, client = _client_for(
        "exec_user", UserRole.EXECUTIVE, default_org, default_facility,
    )
    return client


@pytest.fixture
def compliance_client(default_org, default_facility):
    _, client = _client_for(
        "compliance_user", UserRole.COMPLIANCE_OFFICER, default_org, default_facility,
    )
    return client


class _Row:
    def __init__(self, status, entry, exit_=None, updated=None):
        self.status = status
        self.entry_timestamp = entry
        self.exit_timestamp = exit_
        self.updated_at = updated


class TestTurnaroundStats:
    def test_math(self):
        now = timezone.now()
        rows = [
            _Row("RELEASED", now - timedelta(minutes=120), exit_=now),
            _Row("QUEUED", now - timedelta(minutes=90)),
            _Row("QUEUED", now - timedelta(minutes=10)),
        ]
        stats = compute_turnaround_stats(rows, now=now)
        assert stats["total"] == 3
        assert stats["byStatus"] == {"RELEASED": 1, "QUEUED": 2}
        assert stats["avgWaitMinutes"] == pytest.approx(50.0)
        assert stats["avgTurnaroundMinutes"] == pytest.approx(120.0)
        assert stats["overdueCount"] == 1

    def test_completed_uses_updated_at_when_no_exit(self):
        now = timezone.now()
        rows = [_Row("COMPLETED", now - timedelta(minutes=30), updated=now)]
        stats = compute_turnaround_stats(rows, now=now)
        assert stats["avgTurnaroundMinutes"] == pytest.approx(30.0)
        assert stats["avgWaitMinutes"] is None

    def test_empty(self):
        stats = compute_turnaround_stats([], now=timezone.now())
        assert stats == {
            "total": 0, "byStatus": {}, "avgWaitMinutes": None,
            "avgTurnaroundMinutes": None, "overdueCount": 0,
        }

    def test_corrupt_timestamps_skipped(self):
        now = timezone.now()
        rows = [
            _Row("QUEUED", None),
            _Row("QUEUED", now + timedelta(minutes=5)),  # future entry vs now
        ]
        stats = compute_turnaround_stats(rows, now=now)
        assert stats["total"] == 2
        assert stats["avgWaitMinutes"] is None
        assert stats["overdueCount"] == 0


@pytest.mark.django_db
class TestTurnaroundEndpoint:
    URL = "/api/reports/turnaround/"

    @pytest.fixture
    def entries(self, default_org, default_facility):
        now = timezone.now()
        e1 = QueueEntry.objects.create(
            organisation=default_org, facility=default_facility,
            reg_number="AAA 1", status="RELEASED",
            entry_timestamp=now - timedelta(minutes=120),
            exit_timestamp=now,
        )
        e2 = QueueEntry.objects.create(
            organisation=default_org, facility=default_facility,
            reg_number="BBB 2", status="QUEUED",
            entry_timestamp=now - timedelta(minutes=90),
        )
        e3 = QueueEntry.objects.create(
            organisation=default_org, facility=default_facility,
            reg_number="CCC 3", status="QUEUED",
            entry_timestamp=now - timedelta(minutes=10),
        )
        return e1, e2, e3

    def test_anonymous_401(self, anon_client, default_facility):
        resp = anon_client.get(self.URL, {"facility": default_facility.id})
        assert resp.status_code == 401

    def test_missing_facility_400(self, api_client):
        assert api_client.get(self.URL).status_code == 400

    def test_compliance_officer_denied(self, compliance_client, default_facility):
        resp = compliance_client.get(self.URL, {"facility": default_facility.id})
        assert resp.status_code == 403

    def test_executive_allowed(self, exec_client, default_facility, entries):
        resp = exec_client.get(self.URL, {"facility": default_facility.id})
        assert resp.status_code == 200
        stats = resp.json()["stats"]
        assert stats["total"] == 3
        assert stats["byStatus"] == {"RELEASED": 1, "QUEUED": 2}
        assert stats["avgWaitMinutes"] == pytest.approx(50.0, abs=1.0)
        assert stats["avgTurnaroundMinutes"] == pytest.approx(120.0)
        assert stats["overdueCount"] == 1

    def test_date_filter(self, api_client, default_facility, entries):
        future = (timezone.now() + timedelta(days=1)).isoformat()
        resp = api_client.get(
            self.URL, {"facility": default_facility.id, "from": future},
        )
        assert resp.status_code == 200
        assert resp.json()["stats"]["total"] == 0

    def test_invalid_date_400(self, api_client, default_facility):
        resp = api_client.get(
            self.URL, {"facility": default_facility.id, "from": "not-a-date"},
        )
        assert resp.status_code == 400
        assert "invalid from datetime" in resp.json()["error"]


@pytest.mark.django_db
class TestReportExport:
    URL = "/api/reports/export.csv"

    def test_csv(self, api_client, default_facility, default_org):
        QueueEntry.objects.create(
            organisation=default_org, facility=default_facility,
            reg_number="ABC 1", driver_name="J. Moyo", status="QUEUED",
        )
        resp = api_client.get(self.URL, {"facility": default_facility.id})
        assert resp.status_code == 200
        assert resp["Content-Type"].startswith("text/csv")
        lines = resp.content.decode().splitlines()
        assert lines[0].startswith("id,reg_number,driver_name")
        assert len(lines) == 2
        assert "ABC 1" in lines[1]

    def test_requires_facility(self, api_client):
        assert api_client.get(self.URL).status_code == 400


@pytest.mark.django_db
class TestComplianceConfigRead:
    URL = "/api/compliance/config/"

    def test_anonymous_401(self, anon_client):
        assert anon_client.get(self.URL).status_code == 401

    def test_empty_then_rows(self, api_client, default_org):
        assert api_client.get(self.URL).json() == {
            "ok": True, "count": 0, "config": [],
        }
        from yard.models import ComplianceConfig
        ComplianceConfig.objects.create(
            organisation=default_org, route_type="BEITBRIDGE",
            vehicle_type="TANKER", axle_limits=[1, 2, 3],
        )
        data = api_client.get(self.URL).json()
        assert data["count"] == 1
        assert data["config"][0]["axle_limits"] == [1, 2, 3]


@pytest.mark.django_db
class TestSeedReset:
    SEED_URL = "/api/admin/seed/"
    RESET_URL = "/api/admin/reset/"

    def test_admin_seeds(self, admin_client, default_facility, default_org):
        resp = admin_client.post(self.SEED_URL, {"facility": default_facility.id})
        assert resp.status_code == 200
        created = resp.json()["created"]
        assert created == {
            "docks": 4, "equipment": 3, "queue": 7, "alerts": 2, "config": 30,
        }
        assert QueueEntry.objects.filter(facility=default_facility).count() == 7
        assert Dock.objects.filter(facility=default_facility).count() == 4
        assert Equipment.objects.filter(facility=default_facility).count() == 3
        assert Alert.objects.filter(facility=default_facility).count() == 2
        dock1 = Dock.objects.get(facility=default_facility, name="Dock 1")
        assert dock1.status == "OCCUPIED"
        seed2 = QueueEntry.objects.get(
            facility=default_facility, idempotency_key="q-seed-2",
        )
        assert seed2.status == "ASSIGNED"
        assert seed2.assigned_dock == dock1
        assert dock1.current_entry == seed2
        assert verify_chain(default_facility)["ok"] is True

    def test_reseed_idempotent(self, admin_client, default_facility):
        admin_client.post(self.SEED_URL, {"facility": default_facility.id})
        resp = admin_client.post(self.SEED_URL, {"facility": default_facility.id})
        assert resp.status_code == 200
        data = resp.json()
        assert all(count == 0 for count in data["created"].values())
        assert data["updated"]["queue"] == 7
        assert QueueEntry.objects.filter(facility=default_facility).count() == 7

    def test_operations_cannot_seed(self, api_client, default_facility):
        resp = api_client.post(self.SEED_URL, {"facility": default_facility.id})
        assert resp.status_code == 403

    def test_missing_facility_400(self, admin_client):
        assert admin_client.post(self.SEED_URL, {}).status_code == 400

    def test_foreign_facility_404(self, admin_client, db):
        org = Organisation.objects.create(name="Them", slug="them")
        foreign = Facility.objects.create(organisation=org, name="F", slug="f")
        resp = admin_client.post(self.SEED_URL, {"facility": foreign.id})
        assert resp.status_code == 404

    def test_reset_clears_yard_but_keeps_audit(
        self, admin_client, default_facility, default_org, auth_user,
    ):
        admin_client.post(self.SEED_URL, {"facility": default_facility.id})
        resp = admin_client.post(self.RESET_URL, {"facility": default_facility.id})
        assert resp.status_code == 200
        deleted = resp.json()["deleted"]
        assert deleted["QueueEntry"] == 7
        assert deleted["Dock"] == 4
        assert deleted["Equipment"] == 3
        assert deleted["Alert"] == 2
        assert QueueEntry.objects.filter(facility=default_facility).count() == 0
        assert Dock.objects.filter(facility=default_facility).count() == 0
        # Tenancy + users untouched.
        assert Facility.objects.filter(pk=default_facility.pk).exists()
        assert auth_user.profile.organisation == default_org
        # Reset itself is on the chain; chain still verifies.
        from yard.models import AuditLog
        actions = set(AuditLog.objects.values_list("action", flat=True))
        assert "SEED_YARD" in actions
        assert "RESET_YARD" in actions
        assert verify_chain(default_facility)["ok"] is True

    def test_operations_cannot_reset(self, api_client, default_facility):
        resp = api_client.post(self.RESET_URL, {"facility": default_facility.id})
        assert resp.status_code == 403

    def test_reset_empty_yard(self, admin_client, default_facility):
        resp = admin_client.post(self.RESET_URL, {"facility": default_facility.id})
        assert resp.status_code == 200
        assert all(count == 0 for count in resp.json()["deleted"].values())
