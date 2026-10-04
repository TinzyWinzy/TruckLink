"""Yard API payloads (SAD v2 section 11)."""
from __future__ import annotations

from rest_framework import serializers

from core.models import Facility
from yard.models import Alert, Dock, QueueEntry


class QueueEntrySerializer(serializers.ModelSerializer):
    assigned_dock = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = QueueEntry
        fields = [
            "id", "facility", "reg_number", "driver_name", "haulier",
            "vehicle_type", "cargo_type", "status", "assigned_dock",
            "entry_timestamp", "exit_timestamp", "dwell_duration_seconds",
            "idempotency_key", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "facility", "entry_timestamp", "exit_timestamp",
            "dwell_duration_seconds", "created_at", "updated_at",
        ]


class QueueCreateSerializer(serializers.Serializer):
    facility = serializers.PrimaryKeyRelatedField(queryset=Facility.objects.all())
    reg_number = serializers.CharField(min_length=2, max_length=20)
    driver_name = serializers.CharField(required=False, allow_blank=True, default="")
    haulier = serializers.CharField(required=False, allow_blank=True, default="")
    vehicle_type = serializers.CharField(required=False, allow_blank=True, default="")
    cargo_type = serializers.CharField(required=False, allow_blank=True, default="")
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
    facility = serializers.PrimaryKeyRelatedField(queryset=Facility.objects.all())
    name = serializers.CharField(min_length=1, max_length=100)
    capacity_kg = serializers.FloatField(required=False, min_value=0, default=0.0)


class DockAssignSerializer(serializers.Serializer):
    queue_entry = serializers.PrimaryKeyRelatedField(queryset=QueueEntry.objects.all())


class AlertSerializer(serializers.ModelSerializer):
    acknowledged_by = serializers.SlugRelatedField(slug_field="username", read_only=True)

    class Meta:
        model = Alert
        fields = ["id", "facility", "severity", "message", "category",
                  "acknowledged", "acknowledged_by", "acknowledged_at",
                  "timestamp", "updated_at"]
        read_only_fields = fields
