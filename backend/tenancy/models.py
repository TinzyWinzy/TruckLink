from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from regulatory.models import ImmutableQuerySet


class TenantConfiguration(models.Model):
    organisation = models.ForeignKey('trip.Organisation', on_delete=models.PROTECT, related_name='configuration_revisions')
    version = models.PositiveIntegerField()
    content = models.JSONField()
    digest = models.CharField(max_length=64)
    effective_from = models.DateTimeField(default=timezone.now)
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True)
    reason = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation','version'], name='unique_tenant_config_version')]

    def clean(self):
        from .configuration import validate
        from regulatory.engine.evaluator import digest
        validate(self.content)
        if self.version < 1 or self.digest != digest(self.content) or not self.reason.strip():
            raise ValidationError('Positive configuration version, digest and reason required')
        if self.creator_id and (getattr(self.creator,'profile',None) is None or self.creator.profile.organisation_id != self.organisation_id):
            raise ValidationError('Configuration author must belong to the tenant')

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError('Append a new tenant configuration version')
        self.full_clean()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError('Tenant configuration history is retained')


class Retained(models.Model):
    creator = models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT,null=True,blank=True)
    reason = models.TextField()
    created_at = models.DateTimeField(default=timezone.now,editable=False)
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        abstract = True

    def clean(self):
        if not isinstance(self.reason,str) or not self.reason.strip():
            raise ValidationError('Recorded reason required')
        if self.creator_id and hasattr(self,'organisation_id'):
            profile = getattr(self.creator,'profile',None)
            if not profile or profile.organisation_id != self.organisation_id:
                raise ValidationError('Configuration actor belongs to another tenant')

    def save(self,*args,**kwargs):
        if not self._state.adding:
            raise ValidationError('Append a revision; history is retained')
        self.full_clean()
        return super().save(*args,**kwargs)

    def delete(self,*args,**kwargs):
        raise ValidationError('History is retained')


class TenantArtifactRevision(Retained):
    """Discriminated, strictly validated configuration records, not executable JSON."""
    organisation = models.ForeignKey('trip.Organisation',on_delete=models.PROTECT)
    facility = models.ForeignKey('core.Facility',on_delete=models.PROTECT,null=True,blank=True)
    kind = models.CharField(max_length=24)
    key = models.SlugField(max_length=100)
    version = models.PositiveIntegerField()
    content = models.JSONField()
    digest = models.CharField(max_length=64)
    effective_from = models.DateTimeField(default=timezone.now)
    effective_to = models.DateTimeField(null=True,blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation','kind','key','version'],name='unique_tenant_artifact_version')]

    def clean(self):
        super().clean()
        from regulatory.engine.evaluator import digest
        from .registry import validate_artifact
        if self.facility_id and self.facility.organisation_id != self.organisation_id:
            raise ValidationError('Site belongs to another tenant')
        if self.version < 1 or self.digest != digest(self.content) or (self.effective_to and self.effective_to <= self.effective_from):
            raise ValidationError('Invalid configuration version, digest or dates')
        validate_artifact(self)


class ArtifactReview(Retained):
    organisation = models.ForeignKey('trip.Organisation',on_delete=models.PROTECT)
    artifact = models.ForeignKey(TenantArtifactRevision,on_delete=models.PROTECT)
    approved = models.BooleanField()

    def clean(self):
        super().clean()
        if not self.creator_id or self.artifact.organisation_id != self.organisation_id or self.creator_id == self.artifact.creator_id:
            raise ValidationError('Independent tenant reviewer required')
        if self.creator.profile.role not in ('ADMIN','COMPLIANCE_OFFICER'):
            raise ValidationError('Authorized tenant configuration reviewer required')


class TenantReleaseVersion(Retained):
    organisation = models.ForeignKey('trip.Organisation',on_delete=models.PROTECT)
    version = models.PositiveIntegerField()
    configuration = models.ForeignKey(TenantConfiguration,on_delete=models.PROTECT)
    artifact_ids = models.JSONField()
    digest = models.CharField(max_length=64)
    effective_from = models.DateTimeField(default=timezone.now)
    compatibility = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation','version'],name='unique_tenant_release_version')]

    def clean(self):
        super().clean()
        from regulatory.engine.evaluator import digest
        from .releases import validate_release
        if self.version < 1 or self.digest != digest({'configuration_id':self.configuration_id,'artifact_ids':self.artifact_ids}):
            raise ValidationError('Invalid release version or manifest digest')
        validate_release(self)

    def artifacts_for_activation(self):
        return TenantArtifactRevision.objects.filter(pk__in=self.artifact_ids,organisation=self.organisation)


class ReleaseActivation(Retained):
    organisation = models.ForeignKey('trip.Organisation',on_delete=models.PROTECT)
    release = models.ForeignKey(TenantReleaseVersion,on_delete=models.PROTECT)
    version = models.PositiveIntegerField()
    effective_from = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organisation','version'],name='unique_tenant_activation_version')]

    def clean(self):
        super().clean()
        if self.version < 1 or self.release.organisation_id != self.organisation_id:
            raise ValidationError('Activation must identify its own tenant release')


class WorkflowExecution(Retained):
    organisation = models.ForeignKey('trip.Organisation',on_delete=models.PROTECT)
    facility = models.ForeignKey('core.Facility',on_delete=models.PROTECT)
    queue_entry = models.OneToOneField('yard.QueueEntry',on_delete=models.PROTECT)
    release = models.ForeignKey(TenantReleaseVersion,on_delete=models.PROTECT)
    workflow = models.ForeignKey(TenantArtifactRevision,on_delete=models.PROTECT)
    configuration_snapshot = models.JSONField()

    def clean(self):
        super().clean()
        if any(obj.organisation_id != self.organisation_id for obj in (self.facility,self.queue_entry,self.release,self.workflow)) or self.queue_entry.facility_id != self.facility_id or self.workflow.kind != 'WORKFLOW' or self.workflow.pk not in self.release.artifact_ids:
            raise ValidationError('Workflow execution must reference its tenant, site and release')


class WorkflowEvent(Retained):
    organisation = models.ForeignKey('trip.Organisation',on_delete=models.PROTECT)
    execution = models.ForeignKey(WorkflowExecution,on_delete=models.PROTECT,related_name='events')
    audit = models.OneToOneField('yard.AuditLog',on_delete=models.PROTECT)
    transition = models.CharField(max_length=32)
    state = models.CharField(max_length=32)
    configuration_snapshot = models.JSONField()

    def clean(self):
        super().clean()
        if self.execution.organisation_id != self.organisation_id or self.audit.organisation_id != self.organisation_id or self.audit.facility_id != self.execution.facility_id:
            raise ValidationError('Workflow event is outside execution tenant/site')
