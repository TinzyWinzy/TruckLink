from django.core.exceptions import ValidationError
from django.db import transaction, IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from trip.permissions import get_user_role
from .knowledge import KnowledgeRevision, KnowledgeReview, GovernanceEvent, LegacyKnowledgeMap, governance, rou_snapshot
from .engine.evaluator import digest


def fail(exc):
    return Response({'error':'; '.join(exc.messages) if isinstance(exc,ValidationError) else str(exc)},status=403 if isinstance(exc,PermissionError) else 409)


def custodian(actor):
    if not actor.is_active or not actor.is_superuser:
        raise PermissionError('Platform custodian required; tenant ADMIN is not platform governance')


@api_view(['GET','POST'])
@permission_classes([IsAuthenticated])
def knowledge(request):
    try:
        if request.method == 'GET':
            if not get_user_role(request.user) and not request.user.is_superuser:
                raise PermissionError('Tenant identity required')
            return Response({'revisions':[{'id':r.pk,'kind':r.kind,'key':r.key,'version':r.version,'content':r.content,
                'digest':r.digest,'approved':bool(r.reviews.order_by('-created_at','-pk').values_list('approved',flat=True).first())}
                for r in KnowledgeRevision.objects.order_by('-pk')[:300]]})
        custodian(request.user)
        kind = serializers.ChoiceField(choices=['SOURCE','ROU','PACK']).run_validation(request.data.get('kind'))
        key = serializers.RegexField(r'^[a-zA-Z0-9_-]{1,100}$').run_validation(request.data.get('key'))
        version = serializers.IntegerField(min_value=1).run_validation(request.data.get('version'))
        content = serializers.DictField().run_validation(request.data.get('content'))
        if kind == 'PACK':
            ids = serializers.ListField(child=serializers.IntegerField(min_value=1),allow_empty=False).run_validation(content.get('rou_ids'))
            content['units'] = [rou_snapshot(r) for r in KnowledgeRevision.objects.filter(pk__in=ids,kind='ROU').order_by('pk')]
        with transaction.atomic():
            row = KnowledgeRevision.objects.create(creator=request.user,kind=kind,key=key,version=version,content=content,
                digest=digest(content),reason=request.data.get('reason',''))
            governance(request.user,row,'CREATE',row.reason)
        return Response({'id':row.pk,'digest':row.digest},status=201)
    except (ValidationError,PermissionError,IntegrityError,ValueError,TypeError) as exc:
        return fail(exc)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def review(request,pk):
    try:
        custodian(request.user)
        row = get_object_or_404(KnowledgeRevision,pk=pk)
        approved = serializers.BooleanField().run_validation(request.data.get('approved'))
        with transaction.atomic():
            # All review/publication changes serialize on the immutable subject row.
            KnowledgeRevision.objects.select_for_update().get(pk=row.pk)
            result = KnowledgeReview.objects.create(creator=request.user,revision=row,approved=approved,reason=request.data.get('reason',''))
            governance(request.user,row,'APPROVE' if approved else 'REVOKE',result.reason)
        return Response({'id':result.pk,'approved':approved},status=201)
    except (ValidationError,PermissionError,IntegrityError,ValueError,TypeError) as exc:
        return fail(exc)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def audit(request):
    try:
        custodian(request.user)
        return Response({'events':list(GovernanceEvent.objects.order_by('pk').values('id','revision_id','action','creator_id','reason','previous_hash','hash'))})
    except PermissionError as exc:
        return fail(exc)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def import_legacy(request):
    """Explicit provenance mapping. Import creates drafts, never fabricated review."""
    try:
        custodian(request.user)
        from . import models as m
        from .services import source_snapshot, unit_snapshot
        kind = serializers.ChoiceField(choices=['SOURCE','ROU','PACK']).run_validation(request.data.get('kind'))
        pk = serializers.IntegerField(min_value=1).run_validation(request.data.get('legacy_id'))
        model = {'SOURCE':m.SourceRevision,'ROU':m.RuleUnit,'PACK':m.RuleSetVersion}[kind]
        old = get_object_or_404(model,pk=pk)
        old_content = source_snapshot(old) if kind == 'SOURCE' else unit_snapshot(old) if kind == 'ROU' else old.content
        reason = request.data.get('reason','')
        with transaction.atomic():
            old = model.objects.select_for_update().get(pk=pk)
            if kind == 'SOURCE':
                if old.kind != 'STATUTE':
                    raise ValidationError('Internal policies and manufacturer evidence cannot migrate into statutory knowledge')
                content = {k:v for k,v in old_content.items() if k not in ('id','source_key','revision')}
            elif kind == 'ROU':
                mapping = get_object_or_404(LegacyKnowledgeMap,legacy_kind='SOURCE',legacy_id=old.source_id)
                content = {'source_id':mapping.revision_id,'definition':old.definition}
            else:
                ids = []
                for member in old.members.order_by('unit_id'):
                    ids.append(get_object_or_404(LegacyKnowledgeMap,legacy_kind='ROU',legacy_id=member.unit_id).revision_id)
                content = {k:v for k,v in old.content.items() if k != 'units'}
                content['rou_ids'] = ids
                content['units'] = [rou_snapshot(r) for r in KnowledgeRevision.objects.filter(pk__in=ids).order_by('pk')]
            row = KnowledgeRevision.objects.create(creator=request.user,kind=kind,key=f'legacy-{kind.lower()}-{pk}',
                version=old.version if kind == 'PACK' else old.revision,content=content,digest=digest(content),reason=reason)
            LegacyKnowledgeMap.objects.create(creator=request.user,reason=reason,legacy_kind=kind,legacy_id=pk,
                legacy_digest=digest(old_content),revision=row)
            governance(request.user,row,'IMPORT_DRAFT',reason)
        return Response({'id':row.pk,'digest':row.digest,'approved':False},status=201)
    except (ValidationError,PermissionError,IntegrityError,ValueError,TypeError) as exc:
        return fail(exc)
