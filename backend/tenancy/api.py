"""Tenant-scoped configuration authoring, independent review and activation."""
from django.core.exceptions import ValidationError
from django.db import transaction, IntegrityError
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from trip.models import Organisation
from trip.permissions import get_user_role, get_user_organisation, user_facilities
from regulatory.engine.evaluator import digest
from .models import TenantArtifactRevision, ArtifactReview, TenantReleaseVersion, TenantConfiguration, ReleaseActivation, WorkflowExecution
from .registry import MODULES, TEMPLATES, ADAPTERS
from .releases import activate, active_release, snapshot


def identity(request, write=False):
    org = get_user_organisation(request.user)
    if not org or not get_user_role(request.user) or (write and get_user_role(request.user) != 'ADMIN'):
        raise PermissionError('Tenant administrator required' if write else 'Tenant identity required')
    return org


def error(exc):
    return Response({'error':'; '.join(exc.messages) if isinstance(exc,ValidationError) else str(exc)},
                    status=403 if isinstance(exc,PermissionError) else 409)


def output(row):
    result = {'id':row.pk,'reason':row.reason,'created_at':row.created_at.isoformat()}
    for field in ('kind','key','version','content','digest','facility_id','configuration_id','artifact_ids','release_id','approved'):
        if hasattr(row,field):
            result[field] = getattr(row,field)
    for field in ('effective_from','effective_to'):
        if hasattr(row,field):
            value = getattr(row,field)
            result[field] = value.isoformat() if value else None
    return result


def allowed_rows(model,request,org):
    rows = model.objects.filter(organisation=org)
    if model in (TenantArtifactRevision,WorkflowExecution):
        rows = rows.filter(Q(facility__isnull=True) | Q(facility__in=user_facilities(request.user)))
    return rows


class SiteInput(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    timezone = serializers.CharField(max_length=64)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def sites(request):
    """Provision an operational site without granting operational activation."""
    from core.models import Facility
    from django.utils.text import slugify
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    def serialize(site):
        return {'id': site.pk, 'name': site.name, 'slug': site.slug,
                'timezone': site.timezone, 'placeholder': bool(site.yard_config.get('onboarding'))}
    try:
        org = identity(request, request.method == 'POST')
        if request.method == 'GET':
            return Response({'sites': [serialize(s) for s in user_facilities(request.user).filter(organisation=org, is_deleted=False)]})
        form = SiteInput(data=request.data)
        form.is_valid(raise_exception=True)
        data = form.validated_data
        try:
            ZoneInfo(data['timezone'])
        except (ZoneInfoNotFoundError, ValueError):
            return Response({'error': 'Choose a valid timezone, for example Africa/Harare.'}, status=400)
        with transaction.atomic():
            Organisation.objects.select_for_update().get(pk=org.pk)
            base = slugify(data['name'])[:80] or 'site'
            slug = base
            suffix = 2
            while Facility.objects.filter(organisation=org, slug=slug).exists():
                slug = f'{base}-{suffix}'
                suffix += 1
            site = Facility.objects.create(organisation=org, slug=slug, yard_config={'mode': 'OPERATIONS'}, **data)
            request.user.profile.facilities.add(site)
            from core.audit import append_audit
            append_audit(facility=site, actor=request.user, action='CREATE_SITE', payload={'site_id': site.pk, 'timezone': site.timezone})
        return Response({'site': serialize(site)}, status=201)
    except (PermissionError, IntegrityError) as exc:
        return error(exc)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def registry(request):
    try:
        org = identity(request)
        release = active_release(org)
        activation = ReleaseActivation.objects.filter(organisation=org).order_by('-version').first()
        return Response({'modules':MODULES,'templates':TEMPLATES,'adapters':ADAPTERS,
            'release':output(release) if release else None,'activation_version':activation.version if activation else 0,
            'snapshot':snapshot(org)})
    except PermissionError as exc:
        return error(exc)


class ArtifactInput(serializers.Serializer):
    kind = serializers.ChoiceField(choices=('MODULES','WORKFLOW','SITE','PERMISSIONS','POLICY','PACK_ASSIGNMENT','INTEGRATION'))
    key = serializers.RegexField(r'^[a-zA-Z0-9_-]{1,100}$')
    expected_version = serializers.IntegerField(min_value=0)
    content = serializers.JSONField()
    facility = serializers.IntegerField(min_value=1,allow_null=True,default=None)
    effective_from = serializers.DateTimeField(required=False)
    effective_to = serializers.DateTimeField(required=False,allow_null=True)
    reason = serializers.CharField()


@api_view(['GET','POST'])
@permission_classes([IsAuthenticated])
def revisions(request):
    try:
        org = identity(request,request.method == 'POST')
        if request.method == 'GET':
            rows = list(allowed_rows(TenantArtifactRevision,request,org).order_by('-pk')[:300])
            reviews = {}
            for review_row in ArtifactReview.objects.filter(organisation=org,artifact_id__in=[r.pk for r in rows]).order_by('-pk'):
                reviews.setdefault(review_row.artifact_id, review_row.approved)
            return Response({'revisions':[dict(output(r), authored_by_you=r.creator_id==request.user.pk,
                review_approved=reviews.get(r.pk)) for r in rows]})
        form = ArtifactInput(data=request.data); form.is_valid(raise_exception=True); data = form.validated_data
        if data['kind'] == 'INTEGRATION' and not request.user.is_superuser:
            raise PermissionError('Integration bindings require a platform operator')
        from core.models import Facility
        site = get_object_or_404(user_facilities(request.user).filter(organisation=org),pk=data['facility']) if data['facility'] else None
        with transaction.atomic():
            Organisation.objects.select_for_update().get(pk=org.pk)
            latest = TenantArtifactRevision.objects.filter(organisation=org,kind=data['kind'],key=data['key']).order_by('-version').first()
            version = latest.version if latest else 0
            if data.pop('expected_version') != version:
                raise ValidationError('Artifact changed; refresh before saving')
            data.pop('facility')
            row = TenantArtifactRevision.objects.create(organisation=org,facility=site,creator=request.user,version=version+1,
                digest=digest(data['content']),**data)
            from core.audit import append_audit
            for yard in user_facilities(request.user).filter(organisation=org,is_deleted=False):
                append_audit(facility=yard,actor=request.user,action='CONFIGURE_TENANT_ARTIFACT',payload={'artifact_id':row.pk,'kind':row.kind,'digest':row.digest})
        return Response({'revision':output(row)},status=201)
    except (ValidationError,PermissionError,IntegrityError,ValueError,TypeError) as exc:
        return error(exc)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def review(request,pk):
    try:
        org = identity(request)
        if get_user_role(request.user) not in ('ADMIN','COMPLIANCE_OFFICER'):
            raise PermissionError('Tenant configuration reviewer required')
        row = get_object_or_404(allowed_rows(TenantArtifactRevision,request,org),pk=pk)
        from core.rbac import rbac_allows
        if not rbac_allows(get_user_role(request.user),'regulatory','review',org,row.facility):
            raise PermissionError('Tenant permission profile does not authorize configuration review')
        approved = serializers.BooleanField().run_validation(request.data.get('approved'))
        with transaction.atomic():
            Organisation.objects.select_for_update().get(pk=org.pk)
            revision = ArtifactReview.objects.create(organisation=org,artifact=row,creator=request.user,
                approved=approved,reason=request.data.get('reason',''))
        return Response({'review':output(revision)},status=201)
    except (ValidationError,PermissionError,ValueError,TypeError) as exc:
        return error(exc)


@api_view(['GET','POST'])
@permission_classes([IsAuthenticated])
def releases(request):
    try:
        org = identity(request,request.method == 'POST')
        if request.method == 'GET':
            return Response({'releases':[output(r) for r in TenantReleaseVersion.objects.filter(organisation=org).order_by('-version')[:100]]})
        ids = serializers.ListField(child=serializers.IntegerField(min_value=1),allow_empty=False).run_validation(request.data.get('artifact_ids'))
        if allowed_rows(TenantArtifactRevision,request,org).filter(pk__in=ids).count() != len(set(ids)):
            raise PermissionError('Artifact references are outside authorized tenant/site')
        configuration = get_object_or_404(TenantConfiguration,organisation=org,pk=request.data.get('configuration_id'))
        from django.utils import timezone
        effective = serializers.DateTimeField().run_validation(request.data['effective_from']) if 'effective_from' in request.data else timezone.now()
        with transaction.atomic():
            Organisation.objects.select_for_update().get(pk=org.pk)
            current = TenantReleaseVersion.objects.filter(organisation=org).order_by('-version').first()
            version = current.version if current else 0
            if type(request.data.get('expected_version')) is not int or request.data['expected_version'] != version:
                raise ValidationError('Release changed; refresh before saving')
            row = TenantReleaseVersion.objects.create(organisation=org,creator=request.user,configuration=configuration,
                artifact_ids=ids,version=version+1,reason=request.data.get('reason',''),effective_from=effective,
                digest=digest({'configuration_id':configuration.pk,'artifact_ids':ids}))
        return Response({'release':output(row)},status=201)
    except (ValidationError,PermissionError,IntegrityError,ValueError,TypeError) as exc:
        return error(exc)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def activation(request,pk):
    try:
        org = identity(request,True)
        row = get_object_or_404(TenantReleaseVersion,organisation=org,pk=pk)
        return Response({'activation':output(activate(request.user,row,request.data.get('expected_version'),request.data.get('reason','')))},status=201)
    except (ValidationError,PermissionError,IntegrityError,ValueError,TypeError) as exc:
        return error(exc)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def executions(request):
    try:
        org = identity(request)
        rows = allowed_rows(WorkflowExecution,request,org).order_by('-pk')[:100]
        return Response({'executions':[{'id':r.pk,'queue_entry_id':str(r.queue_entry_id),'release_id':r.release_id,
            'workflow_id':r.workflow_id,'configuration_snapshot':r.configuration_snapshot,
            'events':[{'id':e.pk,'transition':e.transition,'state':e.state,'audit_id':str(e.audit_id),
                'configuration_snapshot':e.configuration_snapshot} for e in r.events.order_by('pk')]} for r in rows]})
    except PermissionError as exc:
        return error(exc)
