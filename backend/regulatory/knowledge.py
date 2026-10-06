"""Platform-owned regulatory revisions and independent governance history."""
from datetime import date, datetime, timezone as utc_timezone
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone
from .models import ImmutableQuerySet
from .engine.evaluator import digest, validate_rule


class PlatformRecord(models.Model):
    creator = models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT)
    reason = models.TextField()
    created_at = models.DateTimeField(default=timezone.now,editable=False)
    objects = ImmutableQuerySet.as_manager()

    class Meta:
        abstract = True

    def clean(self):
        if not self.creator.is_superuser or not self.creator.is_active or not isinstance(self.reason,str) or not self.reason.strip():
            raise ValidationError('Active platform custodian and recorded reason required')

    def save(self,*args,**kwargs):
        if not self._state.adding:
            raise ValidationError('Platform regulatory history is immutable')
        self.full_clean()
        return super().save(*args,**kwargs)

    def delete(self,*args,**kwargs):
        raise ValidationError('Platform regulatory history is retained')


class KnowledgeRevision(PlatformRecord):
    kind = models.CharField(max_length=12,choices=[(x,x) for x in ('SOURCE','ROU','PACK')])
    key = models.SlugField(max_length=100)
    version = models.PositiveIntegerField()
    content = models.JSONField()
    digest = models.CharField(max_length=64)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['kind','key','version'],name='unique_platform_knowledge_version')]

    def clean(self):
        super().clean()
        from tenancy.registry import exact
        c = self.content
        if self.version < 1 or self.digest != digest(c):
            raise ValidationError('Invalid platform revision or digest')
        if self.kind == 'SOURCE':
            exact(c,('title','authority','jurisdiction','kind','tier','provision','document_ref','document_sha256','published_on','effective_from','effective_to'))
            if c['kind'] != 'STATUTE' or c['tier'] not in ('A','B','C','D'):
                raise ValidationError('Platform statutory sources cannot contain company policies or unreviewed extraction')
            if any(not isinstance(c[k],str) or not c[k].strip() for k in ('title','authority','jurisdiction','provision','document_ref')):
                raise ValidationError('Full regulatory source provenance required')
            h = c['document_sha256']
            if not isinstance(h,str) or len(h) != 64 or any(x not in '0123456789abcdef' for x in h):
                raise ValidationError('Canonical source document digest required')
            try:
                start = date.fromisoformat(c['effective_from']); date.fromisoformat(c['published_on'])
                end = date.fromisoformat(c['effective_to']) if c['effective_to'] else None
                if end and end < start:
                    raise ValueError()
            except (ValueError,TypeError):
                raise ValidationError('Invalid source dates') from None
        elif self.kind == 'ROU':
            exact(c,('source_id','definition'))
            if type(c['source_id']) is not int or not KnowledgeRevision.objects.filter(pk=c['source_id'],kind='SOURCE').exists():
                raise ValidationError('ROU requires a platform source revision')
            try:
                validate_rule(c['definition'])
            except ValueError as exc:
                raise ValidationError(str(exc)) from exc
        elif self.kind == 'PACK':
            exact(c,('name','version','jurisdiction','route_type','effective_from','effective_to','max_age_seconds','schema_version','rou_ids','units'))
            if c['version'] != self.version or c['schema_version'] != 1 or c['route_type'] not in ('DOMESTIC','CROSS_BORDER','ABNORMAL') or type(c['max_age_seconds']) is not int or not 1 <= c['max_age_seconds'] <= 86400:
                raise ValidationError('Invalid regulatory pack scope/version')
            try:
                if date.fromisoformat(c['effective_to']) < date.fromisoformat(c['effective_from']):
                    raise ValueError()
            except (ValueError,TypeError):
                raise ValidationError('Invalid pack effective dates') from None
            ids = c['rou_ids']
            if not isinstance(ids,list) or not ids or any(type(i) is not int for i in ids) or len(set(ids)) != len(ids):
                raise ValidationError('Pack requires exact distinct ROU revisions')
            units = [rou_snapshot(r) for r in KnowledgeRevision.objects.filter(pk__in=ids,kind='ROU').order_by('pk')]
            if len(units) != len(ids) or units != c['units'] or len({u['rule_key'] for u in units}) != len(units):
                raise ValidationError('Pack membership must match exact immutable ROU snapshots')
            if any(u['source']['jurisdiction'] != c['jurisdiction'] for u in units):
                raise ValidationError('Pack and source jurisdiction must match')


class KnowledgeReview(PlatformRecord):
    revision = models.ForeignKey(KnowledgeRevision,on_delete=models.PROTECT,related_name='reviews')
    approved = models.BooleanField()

    def clean(self):
        super().clean()
        if self.creator_id == self.revision.creator_id:
            raise ValidationError('Independent platform reviewer required')
        if self.approved and self.revision.kind == 'SOURCE' and self.revision.content['tier'] == 'D':
            raise ValidationError('Tier D extraction remains proposed; publish a source-backed revision for review')
        if self.approved and self.revision.kind == 'PACK':
            if KnowledgeRevision.objects.filter(pk__in=self.revision.content['rou_ids'],creator_id=self.creator_id).exists():
                raise ValidationError('Pack publisher must be independent of ROU authors')
            publication_day = date.fromisoformat(self.revision.content['effective_from'])
            validate_pack(self.revision,datetime.combine(publication_day,datetime.min.time(),tzinfo=utc_timezone.utc),require_publication=False)


class GovernanceEvent(PlatformRecord):
    revision = models.ForeignKey(KnowledgeRevision,on_delete=models.PROTECT)
    action = models.CharField(max_length=24)
    previous_hash = models.CharField(max_length=64,unique=True)
    hash = models.CharField(max_length=64,unique=True)

    def clean(self):
        super().clean()
        expected = digest({'previous':self.previous_hash,'revision':self.revision_id,'action':self.action,'actor':self.creator_id,'reason':self.reason})
        if self.hash != expected:
            raise ValidationError('Invalid platform governance digest')
        prior = GovernanceEvent.objects.order_by('-pk').first()
        if self.previous_hash != (prior.hash if prior else 'GENESIS'):
            raise ValidationError('Governance head changed; retry the complete command')


class LegacyKnowledgeMap(PlatformRecord):
    legacy_kind = models.CharField(max_length=12)
    legacy_id = models.PositiveIntegerField()
    legacy_digest = models.CharField(max_length=64)
    revision = models.ForeignKey(KnowledgeRevision,on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['legacy_kind','legacy_id'],name='unique_legacy_knowledge_mapping')]

    def clean(self):
        super().clean()
        from . import models as m
        from .services import source_snapshot as legacy_source,unit_snapshot
        model = {'SOURCE':m.SourceRevision,'ROU':m.RuleUnit,'PACK':m.RuleSetVersion}.get(self.legacy_kind)
        old = model.objects.filter(pk=self.legacy_id).first() if model else None
        if not old or self.revision.kind != self.legacy_kind:
            raise ValidationError('Migration mapping must identify corresponding original and platform records')
        original = legacy_source(old) if self.legacy_kind == 'SOURCE' else unit_snapshot(old) if self.legacy_kind == 'ROU' else old.content
        if self.legacy_digest != digest(original):
            raise ValidationError('Migration mapping must retain the exact original digest')


def source_snapshot(row):
    return {'id':f'ps:{row.pk}','source_key':row.key,'revision':row.version,**row.content}


def rou_snapshot(row):
    source = KnowledgeRevision.objects.get(pk=row.content['source_id'],kind='SOURCE')
    return {'id':f'rou:{row.pk}','rule_key':row.key,'revision':row.version,
        'definition':row.content['definition'],'source':source_snapshot(source)}


def approved(row):
    review = row.reviews.order_by('-created_at','-pk').first()
    return bool(review and review.approved)


def validate_pack(pack, at, require_publication=True):
    pack.full_clean()
    c = pack.content; day = at.date()
    if pack.kind != 'PACK' or not date.fromisoformat(c['effective_from']) <= day <= date.fromisoformat(c['effective_to']) or (require_publication and not approved(pack)):
        raise ValidationError('Pack is unpublished, revoked or outside effective dates')
    for rou in KnowledgeRevision.objects.filter(pk__in=c['rou_ids'],kind='ROU'):
        source = KnowledgeRevision.objects.get(pk=rou.content['source_id'],kind='SOURCE')
        if not approved(rou) or not approved(source) or date.fromisoformat(source.content['effective_from']) > day or (source.content['effective_to'] and date.fromisoformat(source.content['effective_to']) < day):
            raise ValidationError('Platform source/ROU is unreviewed, revoked or expired')
        if date.fromisoformat(source.content['effective_from']) > date.fromisoformat(c['effective_from']) or (source.content['effective_to'] and date.fromisoformat(source.content['effective_to']) < date.fromisoformat(c['effective_to'])):
            raise ValidationError('Source does not cover the complete pack window')


@transaction.atomic
def governance(actor, row, action, reason):
    previous = GovernanceEvent.objects.select_for_update().order_by('-pk').first()
    previous_hash = previous.hash if previous else 'GENESIS'
    return GovernanceEvent.objects.create(creator=actor,revision=row,action=action,reason=reason,previous_hash=previous_hash,
        hash=digest({'previous':previous_hash,'revision':row.pk,'action':action,'actor':actor.pk,'reason':reason}))
