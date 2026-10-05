from rest_framework import serializers
from . import models as m


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({k: 'Unsupported input field' for k in unknown})
        return super().to_internal_value(data)


class RecordSerializer(serializers.ModelSerializer):
    def get_fields(self):
        fields = super().get_fields()
        org = self.context.get('organisation')
        if org:
            for field in fields.values():
                qs = getattr(field, 'queryset', None)
                if qs is not None and any(f.name == 'organisation' for f in qs.model._meta.fields):
                    field.queryset = qs.filter(organisation=org)
        return fields

    def to_internal_value(self, data):
        allowed = {k for k, field in self.fields.items() if not field.read_only}
        unknown = set(data) - allowed
        if unknown:
            raise serializers.ValidationError({k: 'Read-only or unsupported field' for k in unknown})
        return super().to_internal_value(data)


def record_serializer(model):
    class Serializer(RecordSerializer):
        class Meta:
            fields = '__all__'
            read_only_fields = ('id', 'organisation', 'creator', 'created_at')
        Meta.model = model
    return Serializer


RECORDS = {key: (model, record_serializer(model)) for key, model in {
    'sources': m.SourceRevision, 'evidence': m.EvidenceRevision,
    'vehicle-configurations': m.VehicleConfiguration, 'loads': m.Load,
    'rule-units': m.RuleUnit,
}.items()}


class RuleSetCreateSerializer(StrictSerializer):
    name = serializers.CharField(max_length=100)
    version = serializers.IntegerField(min_value=1)
    jurisdiction = serializers.CharField(max_length=32)
    route_type = serializers.ChoiceField(choices=['DOMESTIC', 'CROSS_BORDER', 'ABNORMAL'])
    effective_from = serializers.DateField()
    effective_to = serializers.DateField()
    max_age_seconds = serializers.IntegerField(min_value=1, max_value=86400, default=3600)
    unit_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), min_length=1)


class ReviewSerializer(StrictSerializer):
    subject = serializers.ChoiceField(choices=['source', 'evidence', 'configuration'])
    subject_id = serializers.IntegerField(min_value=1)
    approved = serializers.BooleanField()
    reason = serializers.CharField(allow_blank=False)


class ReasonSerializer(StrictSerializer):
    reason = serializers.CharField(allow_blank=False)


class ApprovalSerializer(ReasonSerializer):
    approved = serializers.BooleanField()


class ContextSerializer(RecordSerializer):
    evidence_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), default=list)

    class Meta:
        model = m.OperationalContext
        fields = ['configuration', 'driver', 'trip', 'load', 'route_type', 'jurisdictions', 'origin', 'destination', 'evidence_ids']


class InspectionSerializer(StrictSerializer):
    queue_entry = serializers.IntegerField(min_value=1)
    axle_weights = serializers.ListField(child=serializers.DecimalField(max_digits=12, decimal_places=3, min_value=0), min_length=1, max_length=20)
    total_weight = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=0)
    checklist_results = serializers.DictField(default=dict)
    client_key = serializers.CharField(max_length=64, allow_blank=True, default='')
    context_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
