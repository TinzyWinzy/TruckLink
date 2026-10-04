"""Compliance request payloads (SAD v2 section 9/11)."""
from __future__ import annotations

from rest_framework import serializers

from yard.models import QueueEntry


class ComplianceCreateSerializer(serializers.Serializer):
    queue_entry = serializers.PrimaryKeyRelatedField(queryset=QueueEntry.objects.all())
    axle_weights = serializers.ListField(
        child=serializers.FloatField(min_value=0), min_length=1,
    )
    total_weight = serializers.FloatField(min_value=0)
    gvm_rating = serializers.FloatField(min_value=0)
    checklist_results = serializers.DictField(required=False, default=dict)
    vehicle_type = serializers.CharField(required=False)
    route_type = serializers.CharField(required=False, default="DEFAULT")
    limits = serializers.ListField(
        child=serializers.FloatField(), required=False, min_length=1,
    )


class OverrideSerializer(serializers.Serializer):
    reason = serializers.CharField(required=True, allow_blank=False)
