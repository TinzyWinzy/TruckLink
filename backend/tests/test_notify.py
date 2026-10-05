"""Outbox producers + `notify` dispatch + push endpoints (SAD §10)."""
from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from core.audit import verify_chain
from core.models import NotificationLog, OutboxEvent, PushSubscription
from trip.models import UserProfile, UserRole
from yard.models import Alert, AuditLog, ComplianceCheck, QueueEntry

User = get_user_model()


@pytest.fixture(autouse=True)
def audit_salt(settings):
    settings.AUDIT_SALT = "test-only-salt"
    return settings.AUDIT_SALT


@pytest.fixture(autouse=True)
def _no_provider_creds(settings):
    """Every test runs uncredentialed — legs must be LOGGED, never sent."""
    settings.TWILIO_ACCOUNT_SID = ""
    settings.TWILIO_AUTH_TOKEN = ""
    settings.TWILIO_WHATSAPP_NUMBER = ""
    settings.TWILIO_FROM_NUMBER = ""
    settings.VAPID_PRIVATE_KEY = ""
    return settings


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
        "dispatch_notify", UserRole.DISPATCH_SUPERVISOR, default_org, default_facility,
    )
    return client


@pytest.fixture
def other_client(default_org, default_facility):
    _, client = _client_for("other_notify", UserRole.OPERATIONS_SUPERVISOR, default_org, default_facility)
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


def _post_check(client, entry, weights=(9500, 8000, 8000), total=25500, gvm=24000):
    return client.post(
        "/api/compliance/",
        {
            "queue_entry": entry.id,
            "axle_weights": list(weights),
            "total_weight": total,
            "gvm_rating": gvm,
        },
        format="json",
    )


def _post_pass(client, entry):
    return _post_check(client, entry, weights=(6000, 8000, 8000), total=22000)


class TestOutboxProducers:
    def test_fail_creates_quarantine_outbox(self, dispatch_client, queue_entry, default_facility):
        resp = _post_check(dispatch_client, queue_entry)
        assert resp.status_code == 201
        event = OutboxEvent.objects.get()
        assert event.event_type == "QUARANTINE"
        assert event.status == OutboxEvent.Status.PENDING
        assert event.facility == default_facility
        check_id = resp.json()["check"]["id"]
        assert str(event.payload["check_id"]) == str(check_id)
        assert event.payload["queue_entry_id"] == str(queue_entry.id)
        assert Alert.objects.filter(category="COMPLIANCE").count() == 1

    def test_pass_creates_no_outbox(self, dispatch_client, queue_entry):
        resp = _post_pass(dispatch_client, queue_entry)
        assert resp.status_code == 201
        assert resp.json()["check"]["overall_status"] == "PASS"
        assert OutboxEvent.objects.count() == 0

    def test_release_creates_released_outbox(
        self, dispatch_client, queue_entry, default_facility,
    ):
        _post_pass(dispatch_client, queue_entry)
        assert QueueEntry.objects.get(pk=queue_entry.pk).status == "COMPLETED"
        resp = dispatch_client.post(f"/api/queue/{queue_entry.pk}/release/", format="json")
        assert resp.status_code == 200
        event = OutboxEvent.objects.get()
        assert event.event_type == "RELEASED"
        assert event.payload["reg_number"] == "ABC 123"
        assert event.payload["dwell_seconds"] >= 0
        assert AuditLog.objects.filter(action="RELEASE_VEHICLE").count() == 1


class TestNotifyCommand:
    def test_dispatch_without_creds_logs_legs(self, dispatch_client, queue_entry):
        _post_check(dispatch_client, queue_entry)
        call_command("notify", verbosity=0)
        event = OutboxEvent.objects.get()
        assert event.status == OutboxEvent.Status.SENT
        assert event.sent_at is not None
        # No org contact phone -> WhatsApp leg LOGGED, SMS fallback skipped,
        # push LOGGED with no subscriptions.
        statuses = {
            (l.channel, l.status): l.provider_response
            for l in NotificationLog.objects.all()
        }
        assert statuses[("WHATSAPP", NotificationLog.Status.LOGGED)] == "no destination on organisation"
        assert statuses[("PUSH", NotificationLog.Status.LOGGED)] == "no push subscriptions"
        assert not NotificationLog.objects.filter(channel="SMS").exists()
        assert verify_chain(queue_entry.facility)["ok"] is True

    def test_second_run_is_idempotent(self, dispatch_client, queue_entry):
        _post_check(dispatch_client, queue_entry)
        first = call_command("notify", verbosity=0)
        logs_after_first = NotificationLog.objects.count()
        second = call_command("notify", verbosity=0)
        assert NotificationLog.objects.count() == logs_after_first
        assert OutboxEvent.objects.get().status == OutboxEvent.Status.SENT

    def test_sms_fallback_when_whatsapp_not_credentialled(
        self, dispatch_client, queue_entry, default_org, settings,
    ):
        default_org.contact_phone = "+263777000111"
        default_org.save(update_fields=["contact_phone"])
        _post_check(dispatch_client, queue_entry)
        call_command("notify", verbosity=0)
        sms = NotificationLog.objects.filter(channel="SMS").get()
        assert sms.status == NotificationLog.Status.LOGGED
        assert sms.provider_response == "not credentialled"
        assert sms.destination == "+263777000111"
        wa = NotificationLog.objects.filter(channel="WHATSAPP").get()
        assert wa.status == NotificationLog.Status.LOGGED

    def test_escalation_fm_logged_once_until_ack(
        self, dispatch_client, queue_entry,
    ):
        _post_check(dispatch_client, queue_entry)
        event = OutboxEvent.objects.get()
        event.created_at = timezone.now() - timezone.timedelta(minutes=15)
        event.save(update_fields=["created_at"])
        call_command("notify", verbosity=0)
        call_command("notify", verbosity=0)
        fm = NotificationLog.objects.filter(
            event=event, provider_response__startswith="ESCALATION FM",
        )
        assert fm.count() == 1
        assert "10 min" in fm.get().provider_response

    def test_escalation_skips_acknowledged_alert(self, dispatch_client, queue_entry):
        _post_check(dispatch_client, queue_entry)
        Alert.objects.filter(category="COMPLIANCE").update(acknowledged=True)
        event = OutboxEvent.objects.get()
        event.created_at = timezone.now() - timezone.timedelta(minutes=45)
        event.save(update_fields=["created_at"])
        call_command("notify", verbosity=0)
        assert not NotificationLog.objects.filter(
            provider_response__startswith="ESCALATION",
        ).exists()


class TestPushEndpoints:
    def test_generate_vapid_keys_command(self):
        from io import StringIO

        out = StringIO()
        call_command("generate_vapid_keys", stdout=out)
        text = out.getvalue()
        assert "VAPID_PUBLIC_KEY=" in text
        assert "VAPID_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----" in text

    def test_public_key_requires_auth(self, anon_client):
        assert anon_client.get("/api/push/public-key/").status_code == 401

    def test_public_key_returns_vapid(self, api_client, settings):
        settings.VAPID_PUBLIC_KEY = "BEnext"
        resp = api_client.get("/api/push/public-key/")
        assert resp.status_code == 200
        assert resp.json()["public_key"] == "BEnext"

    def test_subscribe_upserts_and_unsubscribes(self, api_client, auth_user, default_facility):
        body = {
            "endpoint": "https://push.example.com/abc",
            "keys": {"p256dh": "p", "auth": "a"},
        }
        resp = api_client.post("/api/push/subscribe/", body, format="json")
        assert resp.status_code == 200
        sub = PushSubscription.objects.get()
        assert sub.user == auth_user
        assert sub.facility == default_facility
        resp = api_client.post(
            "/api/push/subscribe/",
            {**body, "keys": {"p256dh": "p2", "auth": "a2"}},
            format="json",
        )
        assert resp.status_code == 200
        assert PushSubscription.objects.count() == 1
        assert PushSubscription.objects.get().p256dh == "p2"
        api_client.post("/api/push/unsubscribe/", {"endpoint": body["endpoint"]}, format="json")
        assert PushSubscription.objects.count() == 0

    def test_subscribe_requires_keys(self, api_client):
        resp = api_client.post(
            "/api/push/subscribe/", {"endpoint": "https://x"}, format="json",
        )
        assert resp.status_code == 400

    def test_unsubscribe_cannot_delete_others(self, api_client, other_client):
        api_client.post(
            "/api/push/subscribe/",
            {"endpoint": "https://push.example.com/mine", "keys": {"p256dh": "p", "auth": "a"}},
            format="json",
        )
        other_client.post(
            "/api/push/unsubscribe/", {"endpoint": "https://push.example.com/mine"},
            format="json",
        )
        assert PushSubscription.objects.count() == 1
