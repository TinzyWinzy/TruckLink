"""Protected, append-only regulatory provenance and operational snapshots.

No source is verified by creation. Reviews and publication are separate records.
Application guards are supplemented by database constraints and protected FKs;
database administrators still require a separate retention/security policy.
"""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone


class ImmutableQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ValidationError('Append a revision; regulatory records cannot be updated')

    def delete(self):
        raise ValidationError('Regulatory history cannot be deleted')

    def bulk_create(self, objs, **kwargs):
        raise ValidationError('Use validated regulatory commands')

    def bulk_update(self, objs, fields, **kwargs):
        raise ValidationError('Append a revision; regulatory records cannot be updated')


class Record(models.Model):
    organisation = models.ForeignKey('trip.Organisation', on_delete=models.PROTECT)
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        abstract = True

    def clean(self):
        super().clean()
        profile = getattr(self.creator, 'profile', None) if self.creator_id else None
        if profile is None or profile.organisation_id != self.organisation_id:
            raise ValidationError('Record author must belong to the organisation')
        if any(getattr(self, key, 1) < 1 for key in ('revision', 'version')):
            raise ValidationError('Revision and version numbers must be positive')
        # All entity references with an organisation must remain tenant-consistent.
        for field in self._meta.fields:
            if field.is_relation and field.name not in ('organisation', 'creator') and getattr(self, field.attname):
                related = getattr(self, field.name)
                org_id = getattr(related, 'organisation_id', self.organisation_id)
                if org_id != self.organisation_id:
                    raise ValidationError({field.name: 'Related record belongs to another organisation'})

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError('Append a revision; regulatory records cannot be updated')
        self.full_clean()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError('Regulatory history cannot be deleted')


class SourceRevision(Record):
    source_key = models.CharField(max_length=100)
    revision = models.PositiveIntegerField()
    title = models.CharField(max_length=250)
    authority = models.CharField(max_length=200)
    jurisdiction = models.CharField(max_length=32)
    kind = models.CharField(max_length=24, choices=[(x, x) for x in ('STATUTE', 'INTERNAL_POLICY', 'MANUFACTURER')])
    tier = models.CharField(max_length=1, choices=[(x, x) for x in 'ABCD'])
    provision = models.CharField(max_length=200)
    document_ref = models.CharField(max_length=500)
    document_sha256 = models.CharField(max_length=64)
    published_on = models.DateField()
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    supersedes = models.ForeignKey('self', on_delete=models.PROTECT, null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation', 'source_key', 'revision'], name='unique_reg_source_revision')]

    def clean(self):
        super().clean()
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValidationError('Invalid source effective date range')
        if self.supersedes_id and (self.supersedes.source_key != self.source_key or self.revision <= self.supersedes.revision):
            raise ValidationError('Source revision must advance the same source key')
        if len(self.document_sha256) != 64 or any(c not in '0123456789abcdef' for c in self.document_sha256):
            raise ValidationError('A lowercase SHA-256 document digest is required')


class Load(Record):
    reference = models.CharField(max_length=100)
    cargo_class = models.CharField(max_length=64)
    description = models.TextField(blank=True)
    declared_mass_kg = models.DecimalField(max_digits=12, decimal_places=3)
    dimensions_mm = models.JSONField(default=dict, blank=True)

    def clean(self):
        super().clean()
        if self.declared_mass_kg < 0:
            raise ValidationError('Declared load mass must be nonnegative')
        if not isinstance(self.dimensions_mm, dict) or any(k not in ('length', 'width', 'height') or isinstance(v, bool) or not isinstance(v, int) or v <= 0 for k, v in self.dimensions_mm.items()):
            raise ValidationError('Dimensions must be positive integer millimetres')


class EvidenceRevision(Record):
    evidence_key = models.CharField(max_length=100)
    revision = models.PositiveIntegerField()
    kind = models.CharField(max_length=64)
    issuer = models.CharField(max_length=200)
    document_ref = models.CharField(max_length=500)
    document_sha256 = models.CharField(max_length=64)
    issued_at = models.DateTimeField()
    expires_at = models.DateTimeField()
    vehicle = models.ForeignKey('trip.Vehicle', on_delete=models.PROTECT, null=True, blank=True)
    driver = models.ForeignKey('trip.Driver', on_delete=models.PROTECT, null=True, blank=True)
    trip = models.ForeignKey('trip.Trip', on_delete=models.PROTECT, null=True, blank=True)
    load = models.ForeignKey(Load, on_delete=models.PROTECT, null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation', 'evidence_key', 'revision'], name='unique_evidence_revision')]

    def clean(self):
        super().clean()
        if sum(bool(getattr(self, f'{key}_id')) for key in ('vehicle', 'driver', 'trip', 'load')) != 1:
            raise ValidationError('Evidence must identify exactly one entity')
        if self.expires_at <= self.issued_at:
            raise ValidationError('Evidence expiry must follow issue time')
        if len(self.document_sha256) != 64 or any(c not in '0123456789abcdef' for c in self.document_sha256):
            raise ValidationError('A lowercase SHA-256 document digest is required')


class VehicleConfiguration(Record):
    vehicle = models.ForeignKey('trip.Vehicle', on_delete=models.PROTECT)
    revision = models.PositiveIntegerField()
    vehicle_class = models.CharField(max_length=64)
    axle_layout = models.JSONField()
    rated_axle_kg = models.JSONField()
    rated_gross_kg = models.DecimalField(max_digits=12, decimal_places=3)
    rating_evidence = models.ForeignKey(EvidenceRevision, on_delete=models.PROTECT)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['vehicle', 'revision'], name='unique_vehicle_config_revision')]

    def clean(self):
        super().clean()
        from regulatory.engine.evaluator import positive_masses
        if not isinstance(self.axle_layout, list) or not self.axle_layout or any(not isinstance(x, dict) or set(x) != {'position', 'kind'} or x['position'] != i + 1 or not isinstance(x['kind'], str) or not x['kind'].strip() for i, x in enumerate(self.axle_layout)):
            raise ValidationError('Axle layout requires ordered position/kind records')
        if not positive_masses(self.rated_axle_kg) or len(self.rated_axle_kg) != len(self.axle_layout) or self.rated_gross_kg <= 0:
            raise ValidationError('Positive, evidenced ratings must match axle layout')
        if self.rating_evidence.vehicle_id != self.vehicle_id or self.rating_evidence.kind != 'VEHICLE_RATING':
            raise ValidationError('Rating evidence must identify this vehicle and VEHICLE_RATING type')
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValidationError('Invalid vehicle configuration effective dates')


class Review(Record):
    source = models.ForeignKey(SourceRevision, on_delete=models.PROTECT, null=True, blank=True)
    evidence = models.ForeignKey(EvidenceRevision, on_delete=models.PROTECT, null=True, blank=True)
    configuration = models.ForeignKey(VehicleConfiguration, on_delete=models.PROTECT, null=True, blank=True)
    approved = models.BooleanField()
    reason = models.TextField()

    class Meta:
        constraints = [models.CheckConstraint(condition=(Q(source__isnull=False, evidence__isnull=True, configuration__isnull=True) | Q(source__isnull=True, evidence__isnull=False, configuration__isnull=True) | Q(source__isnull=True, evidence__isnull=True, configuration__isnull=False)), name='one_review_subject')]

    def clean(self):
        super().clean()
        subjects = [getattr(self, key) for key in ('source', 'evidence', 'configuration') if getattr(self, f'{key}_id')]
        if len(subjects) != 1 or subjects[0].creator_id == self.creator_id or not self.reason.strip():
            raise ValidationError('Independent reviewer and a recorded reason are required')


class RuleUnit(Record):
    rule_key = models.CharField(max_length=100)
    revision = models.PositiveIntegerField()
    source = models.ForeignKey(SourceRevision, on_delete=models.PROTECT)
    definition = models.JSONField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation', 'rule_key', 'revision'], name='unique_rule_unit_revision')]

    def clean(self):
        super().clean()
        from regulatory.engine.evaluator import validate_rule
        validate_rule(self.definition)


class RuleSetVersion(Record):
    name = models.CharField(max_length=100)
    version = models.PositiveIntegerField()
    jurisdiction = models.CharField(max_length=32)
    route_type = models.CharField(max_length=24, choices=[(x, x) for x in ('DOMESTIC', 'CROSS_BORDER', 'ABNORMAL')])
    effective_from = models.DateField()
    effective_to = models.DateField()
    max_age_seconds = models.PositiveIntegerField(default=3600)
    content = models.JSONField()  # exact source/unit revision snapshots, service-built
    digest = models.CharField(max_length=64)
    schema_version = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation', 'name', 'version'], name='unique_ruleset_version')]

    def clean(self):
        super().clean()
        from regulatory.engine.evaluator import digest
        if self.effective_to < self.effective_from or not 1 <= self.max_age_seconds <= 86400 or self.schema_version != 1:
            raise ValidationError('Invalid ruleset date, freshness or schema version')
        if self.digest != digest(self.content) or not self.content.get('units'):
            raise ValidationError('Ruleset content and digest must be resolved by publication commands')
        for key in ('name', 'version', 'jurisdiction', 'route_type', 'max_age_seconds', 'schema_version', 'effective_from', 'effective_to'):
            value = getattr(self, key)
            if self.content.get(key) != (value.isoformat() if key.startswith('effective_') else value):
                raise ValidationError('Ruleset metadata must match canonical content')


class PlatformRuleBundle(models.Model):
    """Explicit platform publication of reusable regulatory content, never entity evidence."""
    origin = models.OneToOneField(RuleSetVersion, on_delete=models.PROTECT)
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    content = models.JSONField()
    digest = models.CharField(max_length=64)
    reason = models.TextField()
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    objects = ImmutableQuerySet.as_manager()

    def clean(self):
        from regulatory.engine.evaluator import digest
        if not self.creator.is_superuser or not self.creator.is_active or self.creator_id == self.origin.creator_id:
            raise ValidationError('Independent platform custodian required')
        if self.digest != digest(self.content) or self.content != self.origin.content or not self.reason.strip():
            raise ValidationError('Catalogue content must match the immutable reviewed origin')
        if any(unit['source']['kind'] == 'INTERNAL_POLICY' for unit in self.content.get('units',[])):
            raise ValidationError('Tenant internal policy cannot be published as platform regulatory content')
        from regulatory.services import validate_bundle
        validate_bundle(self.origin, timezone.datetime.combine(self.origin.effective_from, timezone.datetime.min.time(), tzinfo=timezone.get_current_timezone()))
        if not Publication.objects.filter(ruleset=self.origin).exists():
            raise ValidationError('Origin requires independent publication first')

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError('Platform catalogue history is immutable')
        self.full_clean()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError('Platform catalogue history is retained')


class TenantRuleSelection(Record):
    """Append-only tenant adoption/revocation, separate from platform publication."""
    jurisdiction = models.CharField(max_length=32)
    route_type = models.CharField(max_length=24)
    version = models.PositiveIntegerField()
    bundle = models.ForeignKey(PlatformRuleBundle, on_delete=models.PROTECT, null=True, blank=True)
    reason = models.TextField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation','jurisdiction','route_type','version'], name='unique_tenant_rule_selection')]

    def clean(self):
        super().clean()
        if self.route_type not in ('DOMESTIC','CROSS_BORDER','ABNORMAL') or not self.reason.strip():
            raise ValidationError('Valid route scope and adoption reason required')
        if self.bundle_id and (self.bundle.content['jurisdiction'] != self.jurisdiction or self.bundle.content['route_type'] != self.route_type):
            raise ValidationError('Platform bundle must match tenant adoption scope')


class RuleSetMember(Record):
    ruleset = models.ForeignKey(RuleSetVersion, on_delete=models.PROTECT, related_name='members')
    unit = models.ForeignKey(RuleUnit, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['ruleset', 'unit'], name='unique_ruleset_member')]

    def clean(self):
        super().clean()
        if Publication.objects.filter(ruleset_id=self.ruleset_id).exists():
            raise ValidationError('Published membership is immutable')


class Publication(Record):
    ruleset = models.OneToOneField(RuleSetVersion, on_delete=models.PROTECT, related_name='publication')
    reason = models.TextField()

    def clean(self):
        super().clean()
        if not self.reason.strip() or self.creator_id == self.ruleset.creator_id:
            raise ValidationError('Publication requires independent review with a reason')


class OperationalContext(Record):
    queue_entry = models.ForeignKey('yard.QueueEntry', on_delete=models.PROTECT, related_name='regulatory_contexts')
    configuration = models.ForeignKey(VehicleConfiguration, on_delete=models.PROTECT)
    driver = models.ForeignKey('trip.Driver', on_delete=models.PROTECT)
    trip = models.ForeignKey('trip.Trip', on_delete=models.PROTECT)
    load = models.ForeignKey(Load, on_delete=models.PROTECT)
    route_type = models.CharField(max_length=24, choices=[(x, x) for x in ('DOMESTIC', 'CROSS_BORDER', 'ABNORMAL')])
    jurisdictions = models.JSONField()
    origin = models.CharField(max_length=200)
    destination = models.CharField(max_length=200)
    evidence = models.ManyToManyField(EvidenceRevision, through='ContextEvidence')

    def clean(self):
        super().clean()
        if not isinstance(self.jurisdictions, list) or not self.jurisdictions or any(not isinstance(x, str) or not x.strip() or len(x) > 32 for x in self.jurisdictions) or len(set(self.jurisdictions)) != len(self.jurisdictions):
            raise ValidationError('Explicit unique jurisdiction codes are required')
        if self.route_type == 'DOMESTIC' and len(self.jurisdictions) != 1:
            raise ValidationError('Domestic context requires one jurisdiction')
        if self.route_type == 'CROSS_BORDER' and len(self.jurisdictions) < 2:
            raise ValidationError('Cross-border context requires all traversed jurisdictions')
        if self.trip.vehicle_id != self.configuration.vehicle_id or self.trip.driver_id != self.driver_id:
            raise ValidationError('Trip, driver and configured vehicle must agree')
        if self.trip.facility_id and self.trip.facility_id != self.queue_entry.facility_id:
            raise ValidationError('Trip and operational context must belong to the same yard')
        if self.queue_entry.reg_number.strip().upper() != self.configuration.vehicle.plate.strip().upper():
            raise ValidationError('Queue registration does not match evidenced vehicle')


class ContextEvidence(Record):
    context = models.ForeignKey(OperationalContext, on_delete=models.PROTECT)
    evidence = models.ForeignKey(EvidenceRevision, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['context', 'evidence'], name='unique_context_evidence')]

    def clean(self):
        super().clean()
        if InspectionAttempt.objects.filter(context_id=self.context_id).exists():
            raise ValidationError('Inspected context is immutable; append a new context')
        ctx, evidence = self.context, self.evidence
        if not any(getattr(evidence, f'{key}_id') and getattr(evidence, f'{key}_id') == value for key, value in (
                ('vehicle', ctx.configuration.vehicle_id), ('driver', ctx.driver_id), ('trip', ctx.trip_id), ('load', ctx.load_id))):
            raise ValidationError('Evidence does not identify an entity in this context')


class InspectionAttempt(Record):
    facility = models.ForeignKey('core.Facility', on_delete=models.PROTECT)
    queue_entry = models.ForeignKey('yard.QueueEntry', on_delete=models.PROTECT, related_name='inspection_attempts')
    context = models.ForeignKey(OperationalContext, on_delete=models.PROTECT, null=True, blank=True)
    client_key = models.CharField(max_length=64, blank=True)
    submission_digest = models.CharField(max_length=64)
    occurred_at = models.DateTimeField()
    input_snapshot = models.JSONField()
    context_snapshot = models.JSONField(default=dict, blank=True)
    ruleset_snapshot = models.JSONField(default=list, blank=True)
    tenant_configuration_snapshot = models.JSONField(default=dict, blank=True)
    result = models.JSONField()
    decision = models.CharField(max_length=24)
    engine_version = models.CharField(max_length=24, default='nrok-1')

    class Meta:
        constraints = [models.UniqueConstraint(fields=['facility', 'client_key'], condition=~Q(client_key=''), name='unique_attempt_replay_per_site')]
        ordering = ['-created_at', '-pk']

    def clean(self):
        super().clean()
        if self.facility_id != self.queue_entry.facility_id or (self.context_id and self.context.queue_entry_id != self.queue_entry_id):
            raise ValidationError('Attempt must identify the queue site and its own context')


class OverrideRequest(Record):
    attempt = models.ForeignKey(InspectionAttempt, on_delete=models.PROTECT, related_name='override_requests')
    reason = models.TextField()

    def clean(self):
        super().clean()
        if not self.reason.strip() or not self.attempt.result.get('override_eligible'):
            raise ValidationError('Only permitted controls with a recorded reason can be overridden')


class OverrideApproval(Record):
    request = models.OneToOneField(OverrideRequest, on_delete=models.PROTECT, related_name='approval')
    approved = models.BooleanField()
    reason = models.TextField()

    def clean(self):
        super().clean()
        if self.creator_id in (self.request.creator_id, self.request.attempt.creator_id) or not self.reason.strip():
            raise ValidationError('Independent approval with reason is required')


class ReleaseRecord(Record):
    queue_entry = models.ForeignKey('yard.QueueEntry', on_delete=models.PROTECT, related_name='release_records')
    attempt = models.ForeignKey(InspectionAttempt, on_delete=models.PROTECT)
    approval = models.ForeignKey(OverrideApproval, on_delete=models.PROTECT, null=True, blank=True)
    policy_version = models.CharField(max_length=24, default='gate-1')

    def clean(self):
        super().clean()
        if self.attempt.queue_entry_id != self.queue_entry_id or (self.approval_id and self.approval.request.attempt_id != self.attempt_id):
            raise ValidationError('Release authority must refer to this entry and attempt')


class ReleaseWithdrawal(Record):
    release = models.OneToOneField(ReleaseRecord, on_delete=models.PROTECT, related_name='withdrawal')
    reason = models.TextField()
    client_key = models.CharField(max_length=64)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation','client_key'],name='unique_release_withdrawal_key')]

    def clean(self):
        super().clean()
        if self.release.organisation_id != self.organisation_id or not self.reason.strip():
            raise ValidationError('Withdrawal requires a tenant-owned release and recorded reason')


# Register platform-owned knowledge models without changing legacy app/table labels.
from .knowledge import KnowledgeRevision, KnowledgeReview, GovernanceEvent, LegacyKnowledgeMap  # noqa: E402,F401
