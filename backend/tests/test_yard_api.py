"""B1f: yard API - board, queue, docks, alerts (SAD v2 section 11).

Ports of operations.ts registerVehiclePS / assignDockPS / releaseVehiclePS /
acknowledgeAlertPS semantics, plus RBAC + facility isolation + audit chain.
"""
from __future__ import annotations

import pytest

from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from core.audit import verify_chain
from core.models import Facility
from trip.models import UserProfile, UserRole
from yard.models import Alert, AuditLog, Dock, QueueEntry
from yard.models import ComplianceCheck
from compliance.policy import MANDATORY_CHECKLIST_IDS

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
def dispatch_client(default_org, default_facility):
    _, client = _client_for(
        "dispatch_user", UserRole.DISPATCH_SUPERVISOR, default_org, default_facility,
    )
    return client


@pytest.fixture
def fm_client(default_org, default_facility):
    _, client = _client_for(
        "fm_user", UserRole.FACILITY_MANAGER, default_org, default_facility,
    )
    return client


@pytest.fixture
def exec_client(default_org, default_facility):
    _, client = _client_for(
        "exec_user", UserRole.EXECUTIVE, default_org, default_facility,
    )
    return client


@pytest.fixture
def admin_client(default_org, default_facility):
    _, client = _client_for(
        "admin_user", UserRole.ADMIN, default_org, default_facility,
    )
    return client


@pytest.fixture
def queue_entry(default_org, default_facility, auth_user):
    return QueueEntry.objects.create(
        organisation=default_org,
        facility=default_facility,
        reg_number="ABC 123",
        status="QUEUED",
        created_by=auth_user,
    )


@pytest.fixture
def dock(default_org, default_facility):
    return Dock.objects.create(
        organisation=default_org, facility=default_facility, name="Bay 1",
    )


@pytest.mark.django_db
class TestBoard:
    URL = "/api/yard/board/"

    def test_anonymous_401(self, anon_client):
        assert anon_client.get(self.URL).status_code == 401

    def test_missing_facility_400(self, api_client):
        assert api_client.get(self.URL).status_code == 400

    def test_digest(self, api_client, default_facility, queue_entry, dock):
        Alert.objects.create(
            organisation=queue_entry.organisation,
            facility=default_facility,
            severity="CRITICAL",
            message="test",
        )
        resp = api_client.get(self.URL, {"facility": default_facility.id})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["facility"]["slug"] == "main-yard"
        assert len(data["queue"]) == 1
        assert len(data["docks"]) == 1
        assert len(data["alerts"]) == 1
        assert data["counts"] == {"QUEUED": 1}
        assert data["alerts_unacknowledged"] == 1

    def test_foreign_facility_404(self, api_client, db):
        from trip.models import Organisation
        org = Organisation.objects.create(name="Them", slug="them")
        foreign = Facility.objects.create(organisation=org, name="F", slug="f")
        assert api_client.get(self.URL, {"facility": foreign.id}).status_code == 404

    def test_slug_facility_param(self, api_client, default_facility, queue_entry):
        resp = api_client.get(self.URL, {"facility": "main-yard"})
        assert resp.status_code == 200
        assert resp.json()["facility"]["slug"] == "main-yard"


@pytest.mark.django_db
class TestQueueCreate:
    URL = "/api/queue/"

    def test_dispatch_creates(self, dispatch_client, default_facility, auth_user):
        resp = dispatch_client.post(self.URL, {
            "facility": default_facility.id,
            "reg_number": "abc 123",
            "driver_name": "J. Moyo",
            "haulier": "Hauliers (Pvt) Ltd",
            "vehicle_type": "DRY_VAN",
            "cargo_type": "Maize",
            "expected_destination": "Beitbridge",
        }, format="json")
        assert resp.status_code == 201
        entry = resp.json()["queue_entry"]
        assert entry["reg_number"] == "ABC 123"  # normalized uppercase (BAK)
        assert entry["status"] == "QUEUED"
        assert entry["expected_destination"] == "Beitbridge"
        assert AuditLog.objects.filter(action="CREATE_QUEUE_ENTRY").count() == 1
        assert verify_chain(default_facility)["ok"] is True

    def test_operations_creates(self, api_client, default_facility):
        resp = api_client.post(self.URL, {
            "facility": default_facility.id, "reg_number": "XYZ 777",
        }, format="json")
        assert resp.status_code == 201

    def test_executive_denied(self, exec_client, default_facility):
        resp = exec_client.post(self.URL, {
            "facility": default_facility.id, "reg_number": "XYZ 777",
        }, format="json")
        assert resp.status_code == 403

    def test_anonymous_401(self, anon_client, default_facility):
        resp = anon_client.post(self.URL, {
            "facility": default_facility.id, "reg_number": "XYZ 777",
        }, format="json")
        assert resp.status_code == 401

    def test_foreign_facility_404(self, dispatch_client, db):
        from trip.models import Organisation
        org = Organisation.objects.create(name="Them", slug="them")
        foreign = Facility.objects.create(organisation=org, name="F", slug="f")
        resp = dispatch_client.post(self.URL, {
            "facility": foreign.id, "reg_number": "XYZ 777",
        }, format="json")
        assert resp.status_code == 404

    def test_short_reg_400(self, dispatch_client, default_facility):
        resp = dispatch_client.post(self.URL, {
            "facility": default_facility.id, "reg_number": "A",
        }, format="json")
        assert resp.status_code == 400

    def test_idempotency_replay(self, dispatch_client, default_facility):
        body = {
            "facility": default_facility.id,
            "reg_number": "ABC 123",
            "idempotency_key": "offline-1",
        }
        first = dispatch_client.post(self.URL, body, format="json")
        second = dispatch_client.post(self.URL, body, format="json")
        assert first.status_code == 201
        assert second.status_code == 200
        assert second.json()["idempotent"] is True
        assert second.json()["queue_entry"]["id"] == first.json()["queue_entry"]["id"]
        assert QueueEntry.objects.count() == 1


@pytest.mark.django_db
class TestQueuePatch:
    def test_valid_transition(self, api_client, queue_entry, default_facility):
        resp = api_client.patch(
            f"/api/queue/{queue_entry.id}/", {"status": "ASSIGNED"}, format="json",
        )
        assert resp.status_code == 200
        queue_entry.refresh_from_db()
        assert queue_entry.status == "ASSIGNED"
        assert AuditLog.objects.filter(action="UPDATE_QUEUE_STATUS").count() == 1
        assert verify_chain(default_facility)["ok"] is True

    def test_invalid_transition_409(self, api_client, queue_entry):
        resp = api_client.patch(
            f"/api/queue/{queue_entry.id}/", {"status": "RELEASED"}, format="json",
        )
        assert resp.status_code == 409
        assert "invalid status transition" in resp.json()["error"]
        queue_entry.refresh_from_db()
        assert queue_entry.status == "QUEUED"
        assert AuditLog.objects.filter(action="UPDATE_QUEUE_STATUS").count() == 0

    def test_field_update(self, api_client, queue_entry):
        resp = api_client.patch(
            f"/api/queue/{queue_entry.id}/", {"driver_name": "New Driver"},
            format="json",
        )
        assert resp.status_code == 200
        queue_entry.refresh_from_db()
        assert queue_entry.driver_name == "New Driver"

    def test_executive_denied(self, exec_client, queue_entry):
        resp = exec_client.patch(
            f"/api/queue/{queue_entry.id}/", {"status": "ASSIGNED"}, format="json",
        )
        assert resp.status_code == 403

    def test_foreign_entry_404(self, api_client, db):
        from trip.models import Organisation
        org = Organisation.objects.create(name="Them", slug="them")
        foreign_fac = Facility.objects.create(organisation=org, name="F", slug="f")
        entry = QueueEntry.objects.create(
            organisation=org, facility=foreign_fac, reg_number="ZZZ 9",
        )
        resp = api_client.patch(
            f"/api/queue/{entry.id}/", {"status": "ASSIGNED"}, format="json",
        )
        assert resp.status_code == 404


@pytest.mark.django_db
class TestQueueRelease:
    def test_completed_releases(
        self, api_client, default_org, default_facility, dock, auth_user,
    ):
        entry = QueueEntry.objects.create(
            organisation=default_org, facility=default_facility,
            reg_number="ABC 1", status="COMPLETED", assigned_dock=dock,
        )
        dock.status = "OCCUPIED"
        dock.current_entry = entry
        dock.save(update_fields=["status", "current_entry", "updated_at"])
        ComplianceCheck.objects.create(organisation=default_org, facility=default_facility,
            queue_entry=entry, inspector=auth_user, reg_number=entry.reg_number,
            status="PASSED", checklist_results=dict.fromkeys(MANDATORY_CHECKLIST_IDS, True))

        resp = api_client.post(f"/api/queue/{entry.id}/release/")
        assert resp.status_code == 200
        data = resp.json()["queue_entry"]
        assert data["status"] == "RELEASED"
        assert data["exit_timestamp"] is not None
        assert data["dwell_duration_seconds"] >= 0
        dock.refresh_from_db()
        assert dock.status == "AVAILABLE"
        assert dock.current_entry is None
        assert AuditLog.objects.filter(action="RELEASE_VEHICLE").count() == 1
        assert verify_chain(default_facility)["ok"] is True

    def test_override_status_without_approval_is_blocked(self, api_client, default_org, default_facility):
        entry = QueueEntry.objects.create(
            organisation=default_org, facility=default_facility,
            reg_number="ABC 2", status="OVERRIDE_APPROVED",
        )
        assert api_client.post(f"/api/queue/{entry.id}/release/").status_code == 409

    @pytest.mark.parametrize("status", ["QUEUED", "QUARANTINED", "AT_DOCK"])
    def test_gate_blocks(self, api_client, default_org, default_facility, status):
        entry = QueueEntry.objects.create(
            organisation=default_org, facility=default_facility,
            reg_number="ABC 3", status=status,
        )
        resp = api_client.post(f"/api/queue/{entry.id}/release/")
        assert resp.status_code == 409
        assert "Cannot release" in resp.json()["error"]
        entry.refresh_from_db()
        assert entry.status == status


@pytest.mark.django_db
class TestDocks:
    URL = "/api/docks/"

    def test_admin_creates(self, admin_client, default_facility):
        resp = admin_client.post(
            self.URL, {"facility": default_facility.id, "name": "Bay 9"},
            format="json",
        )
        assert resp.status_code == 201
        assert resp.json()["dock"]["name"] == "Bay 9"

    def test_duplicate_name_409(self, admin_client, default_facility, dock):
        resp = admin_client.post(
            self.URL, {"facility": default_facility.id, "name": dock.name},
            format="json",
        )
        assert resp.status_code == 409

    def test_operations_create_denied(self, api_client, default_facility):
        resp = api_client.post(
            self.URL, {"facility": default_facility.id, "name": "Bay 10"},
            format="json",
        )
        assert resp.status_code == 403

    def test_list(self, api_client, default_facility, dock):
        resp = api_client.get(self.URL, {"facility": default_facility.id})
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

    def test_list_requires_facility(self, api_client):
        assert api_client.get(self.URL).status_code == 400


@pytest.mark.django_db
class TestDockAssign:
    def test_assign_moves_entry_to_dock(
        self, api_client, dock, queue_entry, default_facility,
    ):
        resp = api_client.post(
            f"/api/docks/{dock.id}/assign/", {"queue_entry": queue_entry.id},
            format="json",
        )
        assert resp.status_code == 200
        dock.refresh_from_db()
        queue_entry.refresh_from_db()
        assert dock.status == "OCCUPIED"
        assert dock.current_entry == queue_entry
        assert queue_entry.status == "AT_DOCK"
        assert queue_entry.assigned_dock == dock
        assert AuditLog.objects.filter(action="ASSIGN_DOCK").count() == 1
        assert verify_chain(default_facility)["ok"] is True

    def test_busy_dock_409(self, api_client, dock, queue_entry):
        dock.status = "OCCUPIED"
        dock.save(update_fields=["status", "updated_at"])
        resp = api_client.post(
            f"/api/docks/{dock.id}/assign/", {"queue_entry": queue_entry.id},
            format="json",
        )
        assert resp.status_code == 409
        assert resp.json()["error"] == "Selected dock is not available"

    def test_entry_already_at_dock_409(self, api_client, dock, queue_entry):
        queue_entry.status = "AT_DOCK"
        queue_entry.save(update_fields=["status", "updated_at"])
        resp = api_client.post(
            f"/api/docks/{dock.id}/assign/", {"queue_entry": queue_entry.id},
            format="json",
        )
        assert resp.status_code == 409

    def test_cross_facility_400(
        self, default_org, default_facility, api_client, auth_user, queue_entry,
    ):
        second = Facility.objects.create(
            organisation=default_org, name="Second", slug="second",
        )
        auth_user.profile.facilities.add(second)
        other_dock = Dock.objects.create(
            organisation=default_org, facility=second, name="Bay X",
        )
        resp = api_client.post(
            f"/api/docks/{other_dock.id}/assign/", {"queue_entry": queue_entry.id},
            format="json",
        )
        assert resp.status_code == 400
        assert "different facilities" in resp.json()["error"]

    def test_executive_denied(self, exec_client, dock, queue_entry):
        resp = exec_client.post(
            f"/api/docks/{dock.id}/assign/", {"queue_entry": queue_entry.id},
            format="json",
        )
        assert resp.status_code == 403

    def test_facility_manager_allowed(self, fm_client, dock, queue_entry):
        resp = fm_client.post(
            f"/api/docks/{dock.id}/assign/", {"queue_entry": queue_entry.id},
            format="json",
        )
        assert resp.status_code == 200


@pytest.mark.django_db
class TestAlerts:
    URL = "/api/alerts/"

    @pytest.fixture
    def alert(self, default_org, default_facility):
        return Alert.objects.create(
            organisation=default_org, facility=default_facility,
            severity="CRITICAL", message="QUARANTINE: ABC 123",
        )

    def test_list(self, api_client, default_facility, alert):
        resp = api_client.get(self.URL, {"facility": default_facility.id})
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

    def test_operations_acks(self, api_client, alert, default_facility):
        resp = api_client.post(f"{self.URL}{alert.id}/ack/")
        assert resp.status_code == 200
        alert.refresh_from_db()
        assert alert.acknowledged is True
        assert alert.acknowledged_by.username == "ops"
        assert alert.acknowledged_at is not None
        assert AuditLog.objects.filter(action="ACKNOWLEDGE_ALERT").count() == 1
        assert verify_chain(default_facility)["ok"] is True

    def test_executive_cannot_ack(self, exec_client, alert):
        resp = exec_client.post(f"{self.URL}{alert.id}/ack/")
        assert resp.status_code == 403

    def test_facility_manager_acks(self, fm_client, alert):
        resp = fm_client.post(f"{self.URL}{alert.id}/ack/")
        assert resp.status_code == 200

    def test_foreign_alert_404(self, api_client, db):
        from trip.models import Organisation
        org = Organisation.objects.create(name="Them", slug="them")
        foreign_fac = Facility.objects.create(organisation=org, name="F", slug="f")
        alert = Alert.objects.create(
            organisation=org, facility=foreign_fac,
            severity="LOW", message="x",
        )
        resp = api_client.post(f"{self.URL}{alert.id}/ack/")
        assert resp.status_code == 404
