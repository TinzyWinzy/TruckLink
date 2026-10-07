"""Yard module tables (SAD v2 §4 "Yard module", ported from BAK).

Contract source: web/src/lib/powersync/operations.ts (row shapes)
+ SAD §4/§6/§9 (status enums, audit chain, compliance fields).
"""
from __future__ import annotations

import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone


class QueueEntryStatus(models.TextChoices):
    QUEUED = 'QUEUED', 'Queued'
    ASSIGNED = 'ASSIGNED', 'Assigned'
    AT_DOCK = 'AT_DOCK', 'At dock'
    QUARANTINED = 'QUARANTINED', 'Quarantined'
    PENDING_OVERRIDE = 'PENDING_OVERRIDE', 'Pending override'
    OVERRIDE_APPROVED = 'OVERRIDE_APPROVED', 'Override approved'
    RELEASED = 'RELEASED', 'Released'
    COMPLETED = 'COMPLETED', 'Completed'


class DockStatus(models.TextChoices):
    AVAILABLE = 'AVAILABLE', 'Available'
    OCCUPIED = 'OCCUPIED', 'Occupied'
    MAINTENANCE = 'MAINTENANCE', 'Maintenance'


class AlertSeverity(models.TextChoices):
    CRITICAL = 'CRITICAL', 'Critical'
    HIGH = 'HIGH', 'High'
    MEDIUM = 'MEDIUM', 'Medium'
    LOW = 'LOW', 'Low'


class CheckStatus(models.TextChoices):
    PASSED = 'PASSED', 'Passed'
    QUARANTINED = 'QUARANTINED', 'Quarantined'
    PENDING_OVERRIDE = 'PENDING_OVERRIDE', 'Pending override'
    OVERRIDE_APPROVED = 'OVERRIDE_APPROVED', 'Override approved'


class QueueEntry(models.Model):
    """A truck registered at the gate (offline-capable create via idempotency key)."""

    organisation = models.ForeignKey(
        'trip.Organisation', on_delete=models.CASCADE, related_name='queue_entries',
    )
    facility = models.ForeignKey(
        'core.Facility', on_delete=models.CASCADE, related_name='queue_entries',
    )
    reg_number = models.CharField(max_length=20)
    driver_name = models.CharField(max_length=120, blank=True, default='')
    haulier = models.CharField(max_length=120, blank=True, default='')
    vehicle_type = models.CharField(max_length=50, blank=True, default='')
    cargo_type = models.CharField(max_length=100, blank=True, default='')
    expected_destination = models.CharField(max_length=120, blank=True, default='')
    status = models.CharField(
        max_length=24, choices=QueueEntryStatus.choices, default=QueueEntryStatus.QUEUED,
    )
    assigned_dock = models.ForeignKey(
        'Dock', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='queue_entries',
    )
    entry_timestamp = models.DateTimeField(default=timezone.now)
    exit_timestamp = models.DateTimeField(null=True, blank=True)
    # Legacy timestamps retain their original meaning; new linked visits separate observations.
    milestone_semantics = models.CharField(max_length=24, default='LEGACY_COMBINED',
        choices=[('LEGACY_COMBINED', 'Legacy combined release'), ('SEPARATE_V1', 'Separate yard milestones')])
    release_authorized_at = models.DateTimeField(null=True, blank=True)
    dock_vacated_at = models.DateTimeField(null=True, blank=True)
    dwell_duration_seconds = models.BigIntegerField(null=True, blank=True)
    idempotency_key = models.CharField(max_length=64, blank=True, default='')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='queue_entries_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['entry_timestamp']
        constraints = [
            models.UniqueConstraint(
                fields=['facility', 'idempotency_key'],
                condition=~Q(idempotency_key=''),
                name='unique_queue_idempotency_per_facility',
            ),
        ]
        indexes = [
            models.Index(fields=['facility', 'status'], name='idx_queue_facility_status'),
            models.Index(fields=['facility', 'entry_timestamp'], name='idx_queue_facility_entry'),
        ]

    def __str__(self):
        return f'{self.reg_number} [{self.status}]'


class Dock(models.Model):
    """Loading/unloading dock. current_entry is the queue entry occupying it."""

    organisation = models.ForeignKey(
        'trip.Organisation', on_delete=models.CASCADE, related_name='docks',
    )
    facility = models.ForeignKey(
        'core.Facility', on_delete=models.CASCADE, related_name='docks',
    )
    name = models.CharField(max_length=100)
    status = models.CharField(
        max_length=16, choices=DockStatus.choices, default=DockStatus.AVAILABLE,
    )
    current_entry = models.ForeignKey(
        'QueueEntry', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='+',
    )
    capacity_kg = models.FloatField(default=0.0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['facility', 'name'], name='unique_dock_name_per_facility'),
        ]

    def __str__(self):
        return f'{self.name} [{self.status}]'


class Equipment(models.Model):
    """Yard equipment (scales, cranes, ...). Schema now; UI in R1+ as needed."""

    class Kind(models.TextChoices):
        WEIGHBRIDGE = 'WEIGHBRIDGE', 'Weighbridge'
        CRANE = 'CRANE', 'Crane'
        FORKLIFT = 'FORKLIFT', 'Forklift'
        GENERATOR = 'GENERATOR', 'Generator'
        OTHER = 'OTHER', 'Other'

    organisation = models.ForeignKey(
        'trip.Organisation', on_delete=models.CASCADE, related_name='equipment',
    )
    facility = models.ForeignKey(
        'core.Facility', on_delete=models.CASCADE, related_name='equipment',
    )
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.OTHER)
    status = models.CharField(
        max_length=16, choices=DockStatus.choices, default=DockStatus.AVAILABLE,
    )
    notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['facility', 'name'], name='unique_equipment_name_per_facility'),
        ]

    def __str__(self):
        return f'{self.name} ({self.kind})'


class Alert(models.Model):
    """Yard alert (quarantine raises CRITICAL). Ack is role-gated in the API layer."""

    organisation = models.ForeignKey(
        'trip.Organisation', on_delete=models.CASCADE, related_name='alerts',
    )
    facility = models.ForeignKey(
        'core.Facility', on_delete=models.CASCADE, related_name='alerts',
    )
    severity = models.CharField(max_length=16, choices=AlertSeverity.choices)
    message = models.TextField()
    category = models.CharField(max_length=50, default='GENERAL')
    related_queue_entry = models.ForeignKey(
        "QueueEntry", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="alerts",
    )
    acknowledged = models.BooleanField(default=False)
    acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='alerts_acknowledged',
    )
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    timestamp = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['facility', 'acknowledged'], name='idx_alert_facility_ack'),
        ]

    def __str__(self):
        return f'[{self.severity}] {self.message[:50]}'


class ComplianceCheck(models.Model):
    """Statutory axle/load check (S.I. 129/159). Server result is final (SAD §9)."""

    organisation = models.ForeignKey(
        'trip.Organisation', on_delete=models.CASCADE, related_name='compliance_checks',
    )
    facility = models.ForeignKey(
        'core.Facility', on_delete=models.CASCADE, related_name='compliance_checks',
    )
    queue_entry = models.ForeignKey(
        QueueEntry, on_delete=models.CASCADE, related_name='compliance_checks',
    )
    reg_number = models.CharField(max_length=20)
    vehicle_type = models.CharField(max_length=50, default='DEFAULT')
    route_type = models.CharField(max_length=50, default='DEFAULT')
    axle_weights = models.JSONField(default=list, blank=True)
    measured_total_kg = models.FloatField(default=0.0)
    max_permissible_kg = models.FloatField(default=0.0)
    overload_kg = models.FloatField(default=0.0)
    overload_fee_usd = models.FloatField(default=0.0)
    checklist_results = models.JSONField(default=dict, blank=True)
    # Client-supplied idempotency key (PWA offline outbox replay) — same check
    # never writes twice. Empty for direct/API calls.
    client_key = models.CharField(max_length=64, blank=True, default='', db_index=True)
    submission_digest = models.CharField(max_length=64, blank=True, default='')
    status = models.CharField(
        max_length=24, choices=CheckStatus.choices, default=CheckStatus.PASSED,
    )
    inspector = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='compliance_checks_inspected',
    )
    timestamp = models.DateTimeField(default=timezone.now)
    override_reason = models.TextField(blank=True, default='')
    override_requester = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='compliance_overrides_requested',
    )
    override_authorizer = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='compliance_overrides_approved',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-timestamp']
        constraints = [
            models.UniqueConstraint(fields=['facility', 'client_key'],
                                    condition=~Q(client_key=''),
                                    name='unique_check_key_per_facility'),
        ]
        indexes = [
            models.Index(fields=['facility', 'status'], name='idx_check_facility_status'),
        ]

    def __str__(self):
        return f'{self.reg_number} [{self.status}] +{self.overload_kg}kg'


class ComplianceConfig(models.Model):
    """Tenant S.I. axle-limit table: route × vehicle type (data, not law — SAD §9)."""

    organisation = models.ForeignKey(
        'trip.Organisation', on_delete=models.CASCADE, related_name='compliance_configs',
    )
    route_type = models.CharField(max_length=50, default='DEFAULT')
    vehicle_type = models.CharField(max_length=50, default='DEFAULT')
    axle_limits = models.JSONField(default=list, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['route_type', 'vehicle_type']
        constraints = [
            models.UniqueConstraint(
                fields=['organisation', 'route_type', 'vehicle_type'],
                name='unique_si_config_per_org_route_vehicle',
            ),
        ]

    def __str__(self):
        return f'{self.organisation.slug}:{self.route_type}/{self.vehicle_type}'


class AuditLog(models.Model):
    """Append-only hash-chained audit row (SAD §6, port of server/src/audit/append.ts).

    payload is TEXT (exact bytes the hash covers) — never JSONField.
    id is client-suppliable (offline replay idempotency: ON CONFLICT no-op).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organisation = models.ForeignKey(
        'trip.Organisation', on_delete=models.CASCADE, related_name='audit_logs',
    )
    facility = models.ForeignKey(
        'core.Facility', on_delete=models.CASCADE, related_name='audit_logs',
    )
    action = models.CharField(max_length=100)
    payload = models.TextField()
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='audit_entries',
    )
    actor_ref = models.CharField(max_length=64, blank=True, default='')
    timestamp = models.DateTimeField(default=timezone.now)
    previous_hash = models.CharField(max_length=64, default='')
    hash = models.CharField(max_length=64, default='')

    class Meta:
        ordering = ['facility', 'timestamp']

    def __str__(self):
        return f'{self.action}@{self.facility_id} seq-hash={self.hash[:12]}'

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError('audit_log is append-only: updates are forbidden')
        super().save(*args, **kwargs)

    def delete(self, using=None, keep_parents=False):
        raise ValidationError('audit_log is append-only: deletes are forbidden')
