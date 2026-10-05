"""Platform tables: tenancy spine, credentials, audit meta, outbox, notifications.

SAD v2 §4 "Platform" — migration order 0001 platform → 0002 yard → 0003 fleet.
"""
from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from trip.models import UserRole


class Facility(models.Model):
    """A physical yard/site inside an organisation (tenancy spine: org → facility)."""

    organisation = models.ForeignKey(
        'trip.Organisation', on_delete=models.CASCADE, related_name='facilities',
    )
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=100)
    timezone = models.CharField(max_length=64, default='Africa/Harare')
    yard_config = models.JSONField(default=dict, blank=True)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['organisation_id', 'name']
        constraints = [
            models.UniqueConstraint(
                fields=['organisation', 'slug'], name='unique_facility_slug_per_org',
            ),
        ]

    def __str__(self):
        return f'{self.name} ({self.organisation.slug})'

    def delete(self, using=None, keep_parents=False):
        self.is_deleted = True
        self.save(update_fields=['is_deleted', 'updated_at'])


class PinCredential(models.Model):
    """Staff PIN credential (BAK PIN design, server-owned): TRK-<staff-id> + PIN hash."""

    staff_id = models.CharField(max_length=32, unique=True)
    pin_hash = models.CharField(max_length=256)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='pin_credentials',
    )
    organisation = models.ForeignKey(
        'trip.Organisation', on_delete=models.CASCADE, related_name='pin_credentials',
    )
    facility = models.ForeignKey(
        Facility, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='pin_credentials',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.staff_id


class Invite(models.Model):
    """Org invite: token in email/WhatsApp, accepted once, expires."""

    organisation = models.ForeignKey(
        'trip.Organisation', on_delete=models.CASCADE, related_name='invites',
    )
    email = models.EmailField()
    role = models.CharField(max_length=32, choices=UserRole.choices)
    token = models.UUIDField(default=uuid.uuid4, unique=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='invites_sent',
    )
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    @property
    def is_valid(self) -> bool:
        return self.accepted_at is None and self.expires_at > timezone.now()


class AuditMeta(models.Model):
    """Per-facility chain lock row (SAD §6): current_hash + seq, FOR UPDATE target."""

    facility = models.OneToOneField(
        Facility, on_delete=models.CASCADE, related_name='audit_meta',
    )
    current_hash = models.CharField(max_length=64, default='GENESIS')
    seq = models.BigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'audit_meta[{self.facility_id}] seq={self.seq}'


class OutboxEvent(models.Model):
    """Transactional outbox (SAD §10): written in-tx, dispatched async."""

    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        SENT = 'SENT', 'Sent'
        FAILED = 'FAILED', 'Failed'

    organisation = models.ForeignKey(
        'trip.Organisation', on_delete=models.CASCADE, related_name='outbox_events',
    )
    facility = models.ForeignKey(
        Facility, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='outbox_events',
    )
    event_type = models.CharField(max_length=64)
    payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_error = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['created_at']
        indexes = [models.Index(fields=['status', 'created_at'])]


class NotificationLog(models.Model):
    """Per-leg delivery record (SAD §10): never blocks a yard transaction."""

    class Channel(models.TextChoices):
        WHATSAPP = 'WHATSAPP', 'WhatsApp'
        SMS = 'SMS', 'SMS'
        PUSH = 'PUSH', 'Web push'

    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        SENT = 'SENT', 'Sent'
        FAILED = 'FAILED', 'Failed'
        LOGGED = 'LOGGED', 'Logged (not credentialled)'

    organisation = models.ForeignKey(
        'trip.Organisation', on_delete=models.CASCADE, related_name='notification_logs',
    )
    event = models.ForeignKey(
        OutboxEvent, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='notifications',
    )
    channel = models.CharField(max_length=16, choices=Channel.choices)
    destination = models.CharField(max_length=255)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.LOGGED)
    provider_response = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class PushSubscription(models.Model):
    """Web Push (VAPID) subscription — SAD §10 push leg, Firebase-free."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='push_subscriptions',
    )
    facility = models.ForeignKey(
        Facility, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='push_subscriptions',
    )
    endpoint = models.TextField(unique=True)
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'push[{self.user_id}] {self.endpoint[:48]}'
