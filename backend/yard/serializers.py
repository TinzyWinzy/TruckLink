"""Yard API payloads (SAD v2 section 11)."""
from __future__ import annotations

from rest_framework import serializers
from django.db.models import F

from yard.models import Alert, Dock, QueueEntry


class QueueEntrySerializer(serializers.ModelSerializer):
    assigned_dock = serializers.PrimaryKeyRelatedField(read_only=True)
    journey_trip_id = serializers.IntegerField(source='journey_link.trip_id', read_only=True, default=None)

    class Meta:
        model = QueueEntry
        fields = [
            "id", "facility", "reg_number", "driver_name", "haulier",
            "vehicle_type", "cargo_type", "expected_destination", "status",
            "assigned_dock", "entry_timestamp", "exit_timestamp",
            "dwell_duration_seconds", "idempotency_key", "created_at",
            "updated_at", "milestone_semantics", "release_authorized_at", "dock_vacated_at", "journey_trip_id",
        ]
        read_only_fields = [
            "id", "facility", "entry_timestamp", "exit_timestamp",
            "dwell_duration_seconds", "created_at", "updated_at", "milestone_semantics", "release_authorized_at", "dock_vacated_at",
        ]


class PollQueueSerializer(QueueEntrySerializer):
    """The complete row contract consumed by the live polling adapter."""
    class Meta(QueueEntrySerializer.Meta):
        fields = [field for field in QueueEntrySerializer.Meta.fields
                  if field not in ('facility', 'created_at', 'idempotency_key')]
        read_only_fields = [field for field in QueueEntrySerializer.Meta.read_only_fields
                            if field not in ('facility', 'created_at', 'idempotency_key')]


def poll_queue_rows(entries):
    """Read projection preserving the compact serializer's JSON contract.

    Fetch scalar columns and the linked trip ID directly, avoiding construction
    of queue, dock and journey model instances for every polling row.
    """
    fields = [field for field in PollQueueSerializer.Meta.fields if field != 'journey_trip_id']
    rows = list(entries.values(*fields, journey_trip_id=F('journey_link__trip_id')))
    datetime_field = serializers.DateTimeField()
    for row in rows:
        for field in ('entry_timestamp', 'exit_timestamp', 'updated_at', 'release_authorized_at', 'dock_vacated_at'):
            if row[field] is not None:
                row[field] = datetime_field.to_representation(row[field])
    return rows


class QueueCreateSerializer(serializers.Serializer):
    # pk or slug — the PWA only knows VITE_FACILITY_ID (either form).
    facility = serializers.CharField(min_length=1, max_length=100)
    reg_number = serializers.CharField(min_length=2, max_length=20)
    driver_name = serializers.CharField(required=False, allow_blank=True, default="")
    haulier = serializers.CharField(required=False, allow_blank=True, default="")
    vehicle_type = serializers.CharField(required=False, allow_blank=True, default="")
    cargo_type = serializers.CharField(required=False, allow_blank=True, default="")
    expected_destination = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=120,
    )
    idempotency_key = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=64,
    )


class QueueUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = QueueEntry
        fields = ["status", "driver_name", "haulier", "vehicle_type", "cargo_type"]


class DockSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dock
        fields = ["id", "facility", "name", "status", "current_entry",
                  "capacity_kg", "created_at", "updated_at"]
        read_only_fields = ["id", "facility", "created_at", "updated_at"]


class DockCreateSerializer(serializers.Serializer):
    # pk or slug — see QueueCreateSerializer.facility.
    facility = serializers.CharField(min_length=1, max_length=100)
    name = serializers.CharField(min_length=1, max_length=100)
    capacity_kg = serializers.FloatField(required=False, min_value=0, default=0.0)


class DockAssignSerializer(serializers.Serializer):
    queue_entry = serializers.PrimaryKeyRelatedField(queryset=QueueEntry.objects.all())


class AlertSerializer(serializers.ModelSerializer):
    acknowledged_by = serializers.SlugRelatedField(slug_field="username", read_only=True)

    class Meta:
        model = Alert
        fields = ["id", "facility", "severity", "message", "category",
                  "related_queue_entry", "acknowledged", "acknowledged_by",
                  "acknowledged_at", "timestamp", "updated_at"]
        read_only_fields = fields
