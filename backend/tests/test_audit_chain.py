"""B1d: audit chain (SAD §6) — engine semantics + API surface."""
from __future__ import annotations

import uuid

import pytest

from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from core.audit import (
    AuditSaltMissing, append_audit, hash_audit_entry, require_salt, verify_chain,
)
from core.models import AuditMeta
from yard.models import AuditLog

User = get_user_model()


@pytest.fixture(autouse=True)
def audit_salt(settings):
    settings.AUDIT_SALT = "test-only-salt"
    return settings.AUDIT_SALT


@pytest.fixture
def facility(default_facility):
    return default_facility


@pytest.fixture
def compliance_client(default_org, default_facility):
    user = User.objects.create_user(username="compliance_user", password="x")
    from trip.models import UserProfile, UserRole
    profile = UserProfile.objects.create(
        user=user, organisation=default_org, role=UserRole.COMPLIANCE_OFFICER,
    )
    profile.facilities.add(default_facility)
    token, _ = Token.objects.get_or_create(user=user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return client


@pytest.mark.django_db
class TestAppendChain:
    def test_chains_n_entries_and_verifies(self, facility):
        prev = None
        for i in range(10):
            row = append_audit(
                facility=facility, action=f"EVT_{i}", payload={"i": i},
            )
            if prev is not None:
                assert row.previous_hash == prev.hash
            prev = row
        meta = AuditMeta.objects.get(facility=facility)
        assert meta.seq == 10
        assert meta.current_hash == prev.hash
        result = verify_chain(facility)
        assert result["ok"] is True, result["issues"]
        assert result["count"] == 10

    def test_genesis_first_entry(self, facility):
        row = append_audit(facility=facility, action="FIRST", payload={})
        assert row.previous_hash == "GENESIS"

    def test_replay_is_noop(self, facility):
        entry_id = uuid.uuid4()
        first = append_audit(
            facility=facility, action="REPLAY", payload={"a": 1}, entry_id=entry_id,
        )
        assert first is not None
        replay = append_audit(
            facility=facility, action="REPLAY", payload={"a": 1}, entry_id=entry_id,
        )
        assert replay is None
        assert AuditLog.objects.filter(facility=facility).count() == 1
        meta = AuditMeta.objects.get(facility=facility)
        assert meta.seq == 1
        assert verify_chain(facility)["ok"] is True

    def test_missing_salt_fails_closed(self, settings, facility):
        settings.AUDIT_SALT = ""
        with pytest.raises(AuditSaltMissing):
            append_audit(facility=facility, action="NOPE", payload={})
        assert AuditLog.objects.count() == 0
        assert AuditMeta.objects.count() == 0

    def test_hash_matches_reference_algorithm(self, facility, audit_salt):
        row = append_audit(facility=facility, action="REF", payload="raw-string")
        expected = hash_audit_entry("GENESIS", "raw-string", audit_salt)
        assert row.hash == expected

    def test_verify_detects_payload_tamper(self, facility):
        append_audit(facility=facility, action="A", payload={"x": 1})
        append_audit(facility=facility, action="B", payload={"x": 2})
        # Bypass the row guard the way an attacker with DB access would.
        AuditLog.objects.filter(action="A").update(payload='{"x":999}')
        result = verify_chain(facility)
        assert result["ok"] is False
        assert any("tampered" in issue for issue in result["issues"])

    def test_verify_detects_deleted_row(self, facility):
        append_audit(facility=facility, action="A", payload={})
        append_audit(facility=facility, action="B", payload={})
        AuditLog.objects.filter(action="A").delete()
        result = verify_chain(facility)
        assert result["ok"] is False

    def test_verify_detects_meta_tamper(self, facility):
        append_audit(facility=facility, action="A", payload={})
        AuditMeta.objects.filter(facility=facility).update(seq=99)
        result = verify_chain(facility)
        assert result["ok"] is False

    def test_empty_chain_ok(self, facility):
        result = verify_chain(facility)
        assert result["ok"] is True
        assert result["count"] == 0


@pytest.mark.django_db
class TestAuditApi:
    URL = "/api/audit/"

    def test_anonymous_401(self, anon_client, facility):
        assert anon_client.get(self.URL, {"facility": facility.id}).status_code == 401

    def test_missing_facility_param_400(self, compliance_client):
        assert compliance_client.get(self.URL).status_code == 400

    def test_operations_role_denied(self, api_client, facility):
        """OPERATIONS is not in the audit read set (firestore.rules)."""
        resp = api_client.get(self.URL, {"facility": facility.id})
        assert resp.status_code == 403

    def test_compliance_role_allowed(self, compliance_client, facility):
        append_audit(facility=facility, action="X", payload={"k": "v"})
        resp = compliance_client.get(self.URL, {"facility": facility.id})
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 1
        assert data["entries"][0]["action"] == "X"
        assert data["entries"][0]["previous_hash"] == "GENESIS"

    def test_foreign_facility_404(self, compliance_client, db):
        from core.models import Facility
        from trip.models import Organisation
        other_org = Organisation.objects.create(name="Them", slug="them")
        foreign = Facility.objects.create(organisation=other_org, name="F", slug="f")
        resp = compliance_client.get(self.URL, {"facility": foreign.id})
        assert resp.status_code == 404

    def test_verify_ok_200(self, compliance_client, facility):
        append_audit(facility=facility, action="A", payload={})
        resp = compliance_client.get("/api/audit/verify/", {"facility": facility.id})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_verify_tampered_409(self, compliance_client, facility):
        append_audit(facility=facility, action="A", payload={"x": 1})
        AuditLog.objects.filter(action="A").update(payload='{"x":2}')
        resp = compliance_client.get("/api/audit/verify/", {"facility": facility.id})
        assert resp.status_code == 409
        assert resp.json()["ok"] is False

    def test_export_csv(self, compliance_client, facility):
        append_audit(facility=facility, action="A", payload={})
        resp = compliance_client.get("/api/audit/export.csv", {"facility": facility.id})
        assert resp.status_code == 200
        assert resp["Content-Type"].startswith("text/csv")
        body = resp.content.decode()
        assert "previous_hash" in body.splitlines()[0]
        assert len(body.splitlines()) == 2  # header + one row
