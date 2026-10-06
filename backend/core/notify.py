"""Notification dispatch (SAD §10): outbox -> WhatsApp/SMS/web-push -> log.

Producers only append OutboxEvent rows inside their own transaction (never
blocked on a provider call); this module runs later via `manage.py notify`.
Until tenant-bound Twilio/VAPID credentials exist every leg is recorded LOGGED.
Escalation timers come from the tenant workflow; BAK retains its existing
10-minute facility-manager / 30-minute executive settings.
"""
from __future__ import annotations

import json
import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import NotificationLog, OutboxEvent, PushSubscription

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5


def message_for(event: OutboxEvent, facility_name: str) -> str:
    p = event.payload or {}
    if event.event_type == "QUARANTINE":
        return (
            f"QUARANTINE: {p.get('reg_number', '?')} failed axle check at "
            f"{facility_name} (+{p.get('overload_kg', 0):g}kg, fine "
            f"${p.get('overload_fee_usd', 0):g}). Rebalancing required."
        )
    if event.event_type == "RELEASED":
        dwell = p.get("dwell_seconds")
        extra = f" (dwell {int(dwell) // 60} min)" if dwell else ""
        return f"RELEASED: {p.get('reg_number', '?')} left {facility_name}{extra}."
    return f"{event.event_type}: {json.dumps(p, default=str)}"


def _twilio(event):
    from tenancy.integrations import credential
    sid = credential(event.organisation,'twilio','ACCOUNT_SID')
    token = credential(event.organisation,'twilio','AUTH_TOKEN')
    if not sid or not token:
        return None
    from twilio.rest import Client

    return Client(sid, token)


def _log(event, channel, destination, status, response) -> NotificationLog:
    return NotificationLog.objects.create(
        organisation=event.organisation,
        event=event,
        channel=channel,
        destination=destination,
        status=status,
        provider_response=response[:2000],
    )


def _send_via_twilio(event, channel, destination, body, from_number) -> None:
    client = _twilio(event)
    if client is None or not from_number:
        _log(
            event, channel, destination, NotificationLog.Status.LOGGED,
            "not credentialled",
        )
        return
    prefix = "whatsapp:" if channel == NotificationLog.Channel.WHATSAPP else ""
    try:
        msg = client.messages.create(
            from_=f"{prefix}{from_number}",
            to=f"{prefix}{destination}",
            body=body,
        )
        _log(event, channel, destination, NotificationLog.Status.SENT, msg.sid)
    except Exception as exc:  # noqa: BLE001 — provider errors must not crash notify
        logger.warning("notify %s leg failed: %s", channel, exc)
        _log(event, channel, destination, NotificationLog.Status.FAILED, str(exc))


def _push_leg(event, facility_name, body) -> None:
    subs = PushSubscription.objects.filter(user__profile__organisation=event.organisation)
    if not subs:
        _log(
            event, NotificationLog.Channel.PUSH, "-", NotificationLog.Status.LOGGED,
            "no push subscriptions",
        )
        return
    from tenancy.integrations import credential
    private_key = credential(event.organisation,'webpush','PRIVATE_KEY')
    if not private_key:
        _log(
            event, NotificationLog.Channel.PUSH, "-", NotificationLog.Status.LOGGED,
            "not credentialled",
        )
        return
    from pywebpush import WebPushException, webpush

    payload = json.dumps(
        {"title": event.event_type, "body": body, "facility": facility_name},
        default=str,
    )
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=private_key,
                vapid_claims={"sub": f"mailto:{credential(event.organisation,'webpush','CLAIMS_EMAIL')}"},
            )
            _log(
                event, NotificationLog.Channel.PUSH, sub.endpoint,
                NotificationLog.Status.SENT, "webpush ok",
            )
        except WebPushException as exc:
            response = str(getattr(exc, "response", "") or exc)
            if getattr(exc, "response", None) is not None and exc.response.status_code in (404, 410):
                sub.delete()
                _log(
                    event, NotificationLog.Channel.PUSH, sub.endpoint,
                    NotificationLog.Status.FAILED, "subscription expired, removed",
                )
            else:
                _log(
                    event, NotificationLog.Channel.PUSH, sub.endpoint,
                    NotificationLog.Status.FAILED, response,
                )
        except Exception as exc:  # noqa: BLE001
            _log(
                event, NotificationLog.Channel.PUSH, sub.endpoint,
                NotificationLog.Status.FAILED, str(exc),
            )


def dispatch_event(event: OutboxEvent) -> None:
    """Attempt every leg for one event, recording per-leg results (SAD §10)."""
    from tenancy.integrations import credential
    from tenancy.releases import require_module
    require_module(event.organisation,'notifications')
    facility_name = event.facility.name if event.facility_id else event.organisation.name
    body = message_for(event, facility_name)
    phone = (event.organisation.contact_phone or "").strip()

    if not phone:
        _log(
            event, NotificationLog.Channel.WHATSAPP, "-", NotificationLog.Status.LOGGED,
            "no destination on organisation",
        )
        whatsapp_sent = False
    else:
        _send_via_twilio(
            event, NotificationLog.Channel.WHATSAPP, phone, body,
            credential(event.organisation,'twilio','WHATSAPP_NUMBER'),
        )
        whatsapp_sent = NotificationLog.objects.filter(
            event=event, channel=NotificationLog.Channel.WHATSAPP,
            status=NotificationLog.Status.SENT,
        ).exists()

    # SMS is the fallback leg — only when WhatsApp did not deliver.
    if phone and not whatsapp_sent:
        _send_via_twilio(
            event, NotificationLog.Channel.SMS, phone, body,
            credential(event.organisation,'twilio','FROM_NUMBER'),
        )

    _push_leg(event, facility_name, body)


def _escalate_event(event: OutboxEvent) -> int:
    from tenancy.integrations import credential
    from tenancy.configuration import workflow
    from tenancy.releases import module_enabled
    if not module_enabled(event.organisation,'notifications'):
        return 0
    windows = workflow(event.organisation,event.facility)['escalation_minutes']
    age_minutes = (timezone.now() - event.created_at).total_seconds() / 60
    if age_minutes < windows['FM']:
        return 0
    queue_entry_id = (event.payload or {}).get("queue_entry_id")
    if queue_entry_id:
        from yard.models import Alert

        still_active = Alert.objects.filter(
            related_queue_entry_id=queue_entry_id, acknowledged=False,
        ).exists()
        if not still_active:
            return 0
    phone = (event.organisation.contact_phone or "").strip()
    created = 0
    for label, threshold in windows.items():
        if age_minutes < threshold:
            continue
        marker = f"ESCALATION {label}"
        if NotificationLog.objects.filter(
            event=event, provider_response__startswith=marker,
        ).exists():
            continue
        response = f"{marker} ({threshold} min)"
        if not phone:
            response = f"{response}: no destination"
            _log(
                event, NotificationLog.Channel.WHATSAPP, "-", NotificationLog.Status.LOGGED,
                response,
            )
        else:
            _send_via_twilio(
                event, NotificationLog.Channel.WHATSAPP, phone,
                f"ESCALATION ({label}): {message_for(event, event.facility.name if event.facility_id else event.organisation.name)}",
                credential(event.organisation,'twilio','WHATSAPP_NUMBER'),
            )
            NotificationLog.objects.filter(
                event=event, provider_response="not credentialled",
                channel=NotificationLog.Channel.WHATSAPP,
            ).update(provider_response=response)
        created += 1
    return created


def run(limit: int = 50, facility_ref: str = "") -> dict:
    """Drain PENDING outbox events, then record escalation timers."""
    qs = (
        OutboxEvent.objects.filter(status=OutboxEvent.Status.PENDING)
        .select_related("organisation", "facility")
        .order_by("created_at")[: max(1, limit)]
    )
    if facility_ref:
        from .audit_views import find_facility

        # Escalation/dispatch are tenant-agnostic — filter by raw pk or slug
        # without a user context; org scoping happens at event creation.
        try:
            qs = [
                e for e in qs
                if str(e.facility_id) == str(facility_ref)
                or (e.facility and e.facility.slug == facility_ref)
            ]
        except Exception:  # noqa: BLE001
            pass
    done = failed = 0
    for event in qs:
        from tenancy.releases import module_enabled
        if not module_enabled(event.organisation,'notifications'):
            continue  # Preserve pending delivery; disabling a module must not discard outbox work.
        try:
            with transaction.atomic():
                dispatch_event(event)
            event.status = OutboxEvent.Status.SENT
            event.sent_at = timezone.now()
            event.attempts += 1
            event.last_error = ""
        except Exception as exc:  # noqa: BLE001 — one bad event must not stop the drain
            logger.exception("notify dispatch failed for outbox #%s", event.id)
            event.attempts += 1
            event.last_error = str(exc)
            if event.attempts >= MAX_ATTEMPTS:
                event.status = OutboxEvent.Status.FAILED
            failed += 1
        else:
            done += 1
        event.save(update_fields=["status", "sent_at", "attempts", "last_error"])
    escalations = 0
    for event in OutboxEvent.objects.filter(
        event_type="QUARANTINE", status=OutboxEvent.Status.SENT,
    ).select_related("organisation", "facility"):
        try:
            escalations += _escalate_event(event)
        except Exception:  # noqa: BLE001
            logger.exception("escalation failed for outbox #%s", event.id)
    return {"done": done, "failed": failed, "escalations": escalations}
