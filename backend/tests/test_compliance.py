"""B1e: compliance engine + endpoints (SAD v2 section 9).

Engine cases ported from bak-logistics-app compliance.test.ts + siTables.test.ts;
API cases cover the quarantine transaction, override segregation-of-duties and
audit-chain integration.
"""
from __future__ import annotations

import pytest

from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from compliance import engine
from core.audit import verify_chain
from trip.models import Organisation, UserProfile, UserRole
from core.models import Facility
from yard.models import (
    Alert, AuditLog, CheckStatus, ComplianceCheck, ComplianceConfig, QueueEntry,
)

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
def dispatch_user(default_org, default_facility):
    user, client = _client_for(
        "dispatch_user", UserRole.DISPATCH_SUPERVISOR, default_org, default_facility,
    )
    return user, client


@pytest.fixture
def dispatch_client(dispatch_user):
    return dispatch_user[1]


@pytest.fixture
def ops2_client(default_org, default_facility):
    _, client = _client_for(
        "ops2", UserRole.OPERATIONS_SUPERVISOR, default_org, default_facility,
    )
    return client


@pytest.fixture
def admin_client(default_org, default_facility):
    _, client = _client_for("admin2", UserRole.ADMIN, default_org, default_facility)
    return client


@pytest.fixture
def queue_entry(default_org, default_facility, auth_user):
    return QueueEntry.objects.create(
        organisation=default_org,
        facility=default_facility,
        reg_number="ABC 123",
        vehicle_type="DRY_VAN",
        status="AT_DOCK",
        created_by=auth_user,
    )


@pytest.fixture
def payload(queue_entry):
    return {
        "queue_entry": queue_entry.id,
        "axle_weights": [6000, 8000, 8000],
        "total_weight": 22000,
        "gvm_rating": 24000,
        "checklist_results": {"license-check": True},
    }


def _overload_payload(queue_entry):
    return {
        "queue_entry": queue_entry.id,
        "axle_weights": [9500, 8000, 8000],
        "total_weight": 25500,
        "gvm_rating": 24000,
    }


def _quarantined_check(default_org, default_facility, queue_entry, inspector):
    queue_entry.status = "QUARANTINED"
    queue_entry.save(update_fields=["status", "updated_at"])
    return ComplianceCheck.objects.create(
        organisation=default_org,
        facility=default_facility,
        queue_entry=queue_entry,
        reg_number=queue_entry.reg_number,
        status=CheckStatus.QUARANTINED,
        inspector=inspector,
        overload_kg=1500,
        overload_fee_usd=750,
    )


# ---------------------------------------------------------------------------
# Engine (pure ports)
# ---------------------------------------------------------------------------


class TestValidateLoad:
    def test_passes_within_limits(self):
        result = engine.validate_load(
            measured_weights=[6000, 8000, 8000],
            limits=[8000, 9000, 9000],
            total_weight=22000,
            gvm_rating=24000,
        )
        assert result["overall_status"] == "PASS"
        assert result["violations"] == []
        assert all(a["status"] == "PASS" for a in result["axles"])

    def test_fails_axle_and_gvm(self):
        result = engine.validate_load(
            measured_weights=[9500, 8000, 8000],
            limits=[8000, 9000, 9000],
            total_weight=25500,
            gvm_rating=24000,
        )
        assert result["overall_status"] == "FAIL"
        assert result["axles"][0]["status"] == "FAIL"
        assert result["gvm_status"] == "FAIL"
        assert len(result["violations"]) >= 2
        assert result["violations"][0] == "Axle 1: 9500kg exceeds limit 8000kg"

    def test_mismatched_arrays_raise(self):
        with pytest.raises(engine.ComplianceInputError):
            engine.validate_load(
                measured_weights=[6000], limits=[8000, 9000],
                total_weight=6000, gvm_rating=24000,
            )

    @pytest.mark.parametrize("weights,limits,total,gvm", [
        ([], [8000], 0, 24000),
        ([8000], [], 8000, 24000),
        ([-1], [8000], 0, 24000),
        ([8000], [0], 8000, 24000),
        ([8000], [8000], -1, 24000),
        ([8000], [8000], 8000, 0),
    ])
    def test_invalid_inputs_raise(self, weights, limits, total, gvm):
        with pytest.raises(engine.ComplianceInputError):
            engine.validate_load(
                measured_weights=weights, limits=limits,
                total_weight=total, gvm_rating=gvm,
            )


class TestOverload:
    def test_axle_excess_wins(self):
        result = engine.validate_load(
            [9500, 8000, 8000], [8000, 9000, 9000], 22000, 24000,
        )
        kg = engine.overload_kg(result["axles"], 22000, 24000)
        assert kg == 1500
        assert engine.overload_fee_usd(kg) == 750.0

    def test_gvm_excess_wins(self):
        result = engine.validate_load(
            [6000, 8000, 8000], [8000, 9000, 9000], 25500, 24000,
        )
        kg = engine.overload_kg(result["axles"], 25500, 24000)
        assert kg == 1500

    def test_no_overload_is_zero(self):
        result = engine.validate_load(
            [6000, 8000, 8000], [8000, 9000, 9000], 22000, 24000,
        )
        assert engine.overload_kg(result["axles"], 22000, 24000) == 0


class TestCanTransition:
    def test_quarantine_override_release_chain(self):
        assert engine.can_transition("QUARANTINED", "PENDING_OVERRIDE")
        assert engine.can_transition("PENDING_OVERRIDE", "OVERRIDE_APPROVED")
        assert engine.can_transition("OVERRIDE_APPROVED", "RELEASED")

    def test_blocked_moves(self):
        assert not engine.can_transition("RELEASED", "QUEUED")
        assert not engine.can_transition("QUARANTINED", "RELEASED")
        assert not engine.can_transition("QUEUED", "RELEASED")

    def test_unknown_status_denied(self):
        assert not engine.can_transition("TELEPORTED", "RELEASED")


class TestResolveSiLimits:
    REMOTE = {
        "siTablesByRoute": {
            "BEITBRIDGE": {"TANKER": [1000, 1000, 1000], "DEFAULT": [2000, 2000, 2000]},
        },
        "siTables": {"FLATBED": [3000, 3000, 3000]},
        "axleLimits": {"default": [4000, 4000, 4000]},
    }

    def test_remote_route_vehicle_hit(self):
        assert engine.resolve_si_limits("BEITBRIDGE", "TANKER", self.REMOTE) == [1000] * 3

    def test_remote_route_default_fallback(self):
        assert engine.resolve_si_limits("BEITBRIDGE", "DRY_VAN", self.REMOTE) == [2000] * 3

    def test_remote_flat_table(self):
        assert engine.resolve_si_limits("CHIRUNDU", "FLATBED", self.REMOTE) == [3000] * 3

    def test_remote_axle_limits_default(self):
        assert engine.resolve_si_limits("CHIRUNDU", "DRY_VAN", self.REMOTE) == [4000] * 3

    def test_bundled_when_no_remote(self):
        assert engine.resolve_si_limits("CHIRUNDU", "DRY_VAN") == [8000, 9000, 9000]

    def test_bundled_vehicle_table(self):
        assert engine.resolve_si_limits(None, "TANKER") == [8000, 8000, 9000]

    def test_final_fallback(self):
        remote = {"siTablesByRoute": {"DEFAULT": {}}}
        assert engine.resolve_si_limits("MARS", "TELEPORT", remote) == [8000, 9000, 9000]

    def test_normalize(self):
        assert engine.normalize_route("beitbridge") == "BEITBRIDGE"
        assert engine.normalize_route("MARS") == "DEFAULT"
        assert engine.normalize_route(None) == "DEFAULT"
        assert engine.normalize_vehicle(None) == "DEFAULT"
        assert engine.normalize_vehicle("") == "DEFAULT"


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestComplianceApi:
    URL = "/api/compliance/"

    def test_anonymous_401(self, anon_client, payload):
        assert anon_client.get(self.URL).status_code == 401
        assert anon_client.post(self.URL, payload, format="json").status_code == 401

    def test_get_requires_facility_param(self, api_client):
        assert api_client.get(self.URL).status_code == 400

    def test_get_unknown_facility_404(self, api_client, db):
        assert api_client.get(self.URL, {"facility": 999999}).status_code == 404

    def test_get_list_ok(self, api_client, default_facility, dispatch_client, payload):
        dispatch_client.post(self.URL, payload, format="json")
        resp = api_client.get(self.URL, {"facility": default_facility.id})
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

    def test_create_pass_sets_completed(
        self, dispatch_client, payload, default_facility,
    ):
        resp = dispatch_client.post(self.URL, payload, format="json")
        assert resp.status_code == 201
        check = resp.json()["check"]
        assert check["status"] == CheckStatus.PASSED
        assert check["overall_status"] == "PASS"
        assert check["overload_kg"] == 0
        entry = QueueEntry.objects.get(pk=payload["queue_entry"])
        assert entry.status == "COMPLETED"
        assert Alert.objects.count() == 0
        assert AuditLog.objects.filter(action="SUBMIT_COMPLIANCE").count() == 1
        assert verify_chain(default_facility)["ok"] is True

    def test_create_fail_quarantines_with_alert(
        self, dispatch_client, queue_entry, default_facility,
    ):
        resp = dispatch_client.post(
            self.URL, _overload_payload(queue_entry), format="json",
        )
        assert resp.status_code == 201
        check = resp.json()["check"]
        assert check["status"] == CheckStatus.QUARANTINED
        assert check["overall_status"] == "FAIL"
        assert check["overload_kg"] == 1500
        assert check["overload_fee_usd"] == 750
        entry = QueueEntry.objects.get(pk=queue_entry.pk)
        assert entry.status == "QUARANTINED"
        alert = Alert.objects.get()
        assert alert.severity == "CRITICAL"
        assert alert.category == "COMPLIANCE"
        assert "QUARANTINE: ABC 123" in alert.message
        assert "+1500kg, fine $750" in alert.message
        assert verify_chain(default_facility)["ok"] is True

    def test_client_key_replay_is_idempotent(
        self, dispatch_client, queue_entry, default_facility,
    ):
        """PWA offline outbox may replay a completed write — same client_key
        must return the first check, never a second write (SAD §8 outbox)."""
        body = _overload_payload(queue_entry) | {"client_key": "offline-replay-1"}
        first = dispatch_client.post(self.URL, body, format="json")
        assert first.status_code == 201
        second = dispatch_client.post(self.URL, body, format="json")
        assert second.status_code == 200
        assert second.json()["replayed"] is True
        assert second.json()["check"]["id"] == first.json()["check"]["id"]
        assert ComplianceCheck.objects.count() == 1
        assert Alert.objects.count() == 1
        assert AuditLog.objects.filter(action="SUBMIT_COMPLIANCE").count() == 1
        assert verify_chain(default_facility)["ok"] is True

    def test_operations_role_cannot_create(self, api_client, payload):
        assert api_client.post(self.URL, payload, format="json").status_code == 403

    def test_foreign_queue_entry_404(self, dispatch_client, default_facility):
        other_org = Organisation.objects.create(name="Them", slug="them")
        foreign_fac = Facility.objects.create(
            organisation=other_org, name="F", slug="f",
        )
        entry = QueueEntry.objects.create(
            organisation=other_org, facility=foreign_fac, reg_number="ZZZ 9",
        )
        resp = dispatch_client.post(self.URL, {
            "queue_entry": entry.id,
            "axle_weights": [6000],
            "total_weight": 6000,
            "gvm_rating": 24000,
        }, format="json")
        assert resp.status_code == 404

    def test_invalid_pk_400(self, dispatch_client):
        resp = dispatch_client.post(self.URL, {
            "queue_entry": 999999,
            "axle_weights": [6000],
            "total_weight": 6000,
            "gvm_rating": 24000,
        }, format="json")
        assert resp.status_code == 400

    def test_engine_input_error_400(self, dispatch_client, queue_entry):
        resp = dispatch_client.post(self.URL, {
            "queue_entry": queue_entry.id,
            "axle_weights": [6000],
            "limits": [8000, 9000],
            "total_weight": 6000,
            "gvm_rating": 24000,
        }, format="json")
        assert resp.status_code == 400
        assert "same length" in resp.json()["error"]

    def test_released_entry_409(self, dispatch_client, queue_entry):
        queue_entry.status = "RELEASED"
        queue_entry.save(update_fields=["status", "updated_at"])
        resp = dispatch_client.post(
            self.URL, _overload_payload(queue_entry), format="json",
        )
        assert resp.status_code == 409

    def test_tenant_config_overrides_bundled(
        self, dispatch_client, default_org, payload,
    ):
        ComplianceConfig.objects.create(
            organisation=default_org,
            route_type="DEFAULT",
            vehicle_type="DRY_VAN",
            axle_limits=[5000, 5000, 5000],
        )
        resp = dispatch_client.post(self.URL, payload, format="json")
        assert resp.status_code == 201
        check = resp.json()["check"]
        assert check["status"] == CheckStatus.QUARANTINED  # bundled would pass
        assert check["axle_weights"] == [6000, 8000, 8000]


@pytest.mark.django_db
class TestOverrideFlow:
    def test_full_request_approve_flow(
        self, default_org, default_facility, queue_entry, auth_user,
        api_client, ops2_client,
    ):
        check = _quarantined_check(
            default_org, default_facility, queue_entry, auth_user,
        )
        url = f"/api/compliance/{check.id}/override-request/"
        resp = api_client.post(url, {"reason": "scale re-calibrated"}, format="json")
        assert resp.status_code == 200
        check.refresh_from_db()
        assert check.status == CheckStatus.PENDING_OVERRIDE
        assert check.override_requester == auth_user

        approve_url = f"/api/compliance/{check.id}/override-approve/"
        # Same user cannot approve their own request (segregation of duties).
        resp = api_client.post(approve_url, {"reason": "approve"}, format="json")
        assert resp.status_code == 400
        assert "Secondary approval violation" in resp.json()["error"]

        resp = ops2_client.post(
            approve_url, {"reason": "verified on re-weigh"}, format="json",
        )
        assert resp.status_code == 200
        check.refresh_from_db()
        assert check.status == CheckStatus.OVERRIDE_APPROVED
        assert check.override_authorizer.username == "ops2"
        assert check.override_reason == "verified on re-weigh"
        entry = QueueEntry.objects.get(pk=queue_entry.pk)
        assert entry.status == "OVERRIDE_APPROVED"
        actions = set(AuditLog.objects.values_list("action", flat=True))
        assert actions == {"REQUEST_OVERRIDE", "APPROVE_OVERRIDE"}
        request_row = AuditLog.objects.get(action="REQUEST_OVERRIDE")
        approve_row = AuditLog.objects.get(action="APPROVE_OVERRIDE")
        assert request_row.actor == auth_user
        assert approve_row.actor.username == "ops2"
        assert verify_chain(default_facility)["ok"] is True

    def test_reason_required(
        self, default_org, default_facility, queue_entry, auth_user, api_client,
    ):
        check = _quarantined_check(
            default_org, default_facility, queue_entry, auth_user,
        )
        url = f"/api/compliance/{check.id}/override-request/"
        assert api_client.post(url, {"reason": ""}, format="json").status_code == 400
        assert api_client.post(url, {}, format="json").status_code == 400
        approve_url = f"/api/compliance/{check.id}/override-approve/"
        resp = api_client.post(approve_url, {"reason": ""}, format="json")
        assert resp.status_code in (400, 409)

    def test_request_only_from_quarantined(
        self, default_org, default_facility, queue_entry, auth_user, api_client,
    ):
        check = ComplianceCheck.objects.create(
            organisation=default_org,
            facility=default_facility,
            queue_entry=queue_entry,
            reg_number="ABC 123",
            status=CheckStatus.PASSED,
            inspector=auth_user,
        )
        url = f"/api/compliance/{check.id}/override-request/"
        resp = api_client.post(url, {"reason": "x"}, format="json")
        assert resp.status_code == 409

    def test_approve_requires_pending_status(
        self, default_org, default_facility, queue_entry, auth_user, api_client,
    ):
        check = _quarantined_check(
            default_org, default_facility, queue_entry, auth_user,
        )
        url = f"/api/compliance/{check.id}/override-approve/"
        resp = api_client.post(url, {"reason": "x"}, format="json")
        assert resp.status_code == 409
        assert "Cannot override check with status" in resp.json()["error"]

    def test_dispatch_cannot_override(
        self, default_org, default_facility, queue_entry, auth_user,
        dispatch_client,
    ):
        check = _quarantined_check(
            default_org, default_facility, queue_entry, auth_user,
        )
        resp = dispatch_client.post(
            f"/api/compliance/{check.id}/override-request/",
            {"reason": "x"}, format="json",
        )
        assert resp.status_code == 403

    def test_admin_may_approve(
        self, default_org, default_facility, queue_entry, auth_user,
        api_client, admin_client,
    ):
        check = _quarantined_check(
            default_org, default_facility, queue_entry, auth_user,
        )
        api_client.post(
            f"/api/compliance/{check.id}/override-request/",
            {"reason": "request"}, format="json",
        )
        resp = admin_client.post(
            f"/api/compliance/{check.id}/override-approve/",
            {"reason": "executive approval"}, format="json",
        )
        assert resp.status_code == 200

    def test_foreign_check_404(self, api_client, db):
        other_org = Organisation.objects.create(name="Them", slug="them")
        foreign_fac = Facility.objects.create(
            organisation=other_org, name="F", slug="f",
        )
        entry = QueueEntry.objects.create(
            organisation=other_org, facility=foreign_fac, reg_number="ZZZ 9",
        )
        check = ComplianceCheck.objects.create(
            organisation=other_org,
            facility=foreign_fac,
            queue_entry=entry,
            reg_number="ZZZ 9",
            status=CheckStatus.QUARANTINED,
        )
        resp = api_client.post(
            f"/api/compliance/{check.id}/override-request/",
            {"reason": "x"}, format="json",
        )
        assert resp.status_code == 404

    def test_request_syncs_entry_to_pending(
        self, default_org, default_facility, queue_entry, auth_user, api_client,
    ):
        check = _quarantined_check(
            default_org, default_facility, queue_entry, auth_user,
        )
        resp = api_client.post(
            f"/api/compliance/{check.id}/override-request/",
            {"reason": "scale re-calibrated"}, format="json",
        )
        assert resp.status_code == 200
        queue_entry.refresh_from_db()
        assert queue_entry.status == "PENDING_OVERRIDE"

    def test_reject_returns_entry_to_quarantine(
        self, default_org, default_facility, queue_entry, auth_user,
        api_client, ops2_client,
    ):
        check = _quarantined_check(
            default_org, default_facility, queue_entry, auth_user,
        )
        api_client.post(
            f"/api/compliance/{check.id}/override-request/",
            {"reason": "manual re-weigh"}, format="json",
        )
        resp = ops2_client.post(
            f"/api/compliance/{check.id}/override-approve/",
            {"reason": "weights still over", "approved": False},
            format="json",
        )
        assert resp.status_code == 200
        check.refresh_from_db()
        assert check.status == CheckStatus.QUARANTINED
        assert check.override_authorizer.username == "ops2"
        queue_entry.refresh_from_db()
        assert queue_entry.status == "QUARANTINED"
        actions = set(AuditLog.objects.values_list("action", flat=True))
        assert "REJECT_OVERRIDE" in actions
        assert verify_chain(default_facility)["ok"] is True
