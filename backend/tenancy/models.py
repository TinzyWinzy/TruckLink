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
