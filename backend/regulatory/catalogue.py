from django.db import transaction
from django.core.exceptions import ValidationError
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from trip.models import Organisation
from trip.permissions import get_user_organisation, get_user_role
from .models import PlatformRuleBundle, TenantRuleSelection, RuleSetVersion
from .services import validate_bundle
from rest_framework import serializers


class CatalogueView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not get_user_role(request.user) and not request.user.is_superuser:
            return Response({'error':'Tenant identity or platform custodian required'},status=403)
        return Response({'bundles':[{'id':row.pk,'digest':row.digest,'content':row.content,'reason':row.reason}
                                  for row in PlatformRuleBundle.objects.order_by('-created_at')[:200]]})

    def post(self, request):
        if not request.user.is_superuser:
            return Response({'error':'Platform custodian required; tenant ADMIN cannot publish globally'},status=403)
        origin_id = serializers.IntegerField(min_value=1).run_validation(request.data.get('ruleset_id'))
        origin = get_object_or_404(RuleSetVersion,pk=origin_id)
        try:
            row = PlatformRuleBundle.objects.create(origin=origin,creator=request.user,content=origin.content,
                                                   digest=origin.digest,reason=request.data.get('reason',''))
            return Response({'id':row.pk,'digest':row.digest},status=201)
        except ValidationError as exc:
            return Response({'error':'; '.join(exc.messages)},status=409)


class SelectionView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        org = get_user_organisation(request.user)
        if org is None or get_user_role(request.user) is None:
            return Response({'error':'Tenant identity required'},status=403)
        return Response({'selections':list(TenantRuleSelection.objects.filter(organisation=org).order_by('-created_at').values('id','jurisdiction','route_type','version','bundle_id','reason'))})

    @transaction.atomic
    def post(self, request):
        org = get_user_organisation(request.user)
        if not org or get_user_role(request.user) not in ('ADMIN','COMPLIANCE_OFFICER'):
            return Response({'error':'Tenant regulatory administrator required'},status=403)
        from core.rbac import rbac_allows
        if not rbac_allows(get_user_role(request.user),'regulatory','review',org):
            return Response({'error':'Tenant policy does not authorize rule adoption'},status=403)
        Organisation.objects.select_for_update().get(pk=org.pk)
        scope = {key:request.data.get(key,'') for key in ('jurisdiction','route_type')}
        if not all(isinstance(value,str) and value for value in scope.values()):
            return Response({'error':'Jurisdiction and route type required'},status=400)
        latest = TenantRuleSelection.objects.filter(organisation=org,**scope).order_by('-version').first()
        version = latest.version if latest else 0
        if type(request.data.get('expected_version')) is not int or request.data['expected_version'] != version:
            return Response({'error':'Selection changed; refresh first'},status=409)
        bundle_id = serializers.IntegerField(min_value=1,allow_null=True).run_validation(request.data.get('bundle_id'))
        bundle = get_object_or_404(PlatformRuleBundle,pk=bundle_id) if bundle_id else None
        try:
            row = TenantRuleSelection.objects.create(organisation=org,creator=request.user,version=version+1,bundle=bundle,
                                                    reason=request.data.get('reason',''),**scope)
            from core.audit import append_audit
            from trip.permissions import user_facilities
            for yard in user_facilities(request.user).filter(organisation=org,is_deleted=False).order_by('pk'):
                append_audit(facility=yard,actor=request.user,action='ADOPT_PLATFORM_RULES',payload={'selection_id':row.pk,'version':row.version,'bundle_id':bundle_id})
            return Response({'id':row.pk,'version':row.version},status=201)
        except ValidationError as exc:
            return Response({'error':'; '.join(exc.messages)},status=400)


def shared_bundle(context, jurisdiction, at):
    choice = TenantRuleSelection.objects.filter(organisation=context.organisation,jurisdiction=jurisdiction,
                                               route_type=context.route_type,created_at__lte=at).order_by('-version').first()
    if not choice or not choice.bundle_id:
        return None
    bundle = choice.bundle
    validate_bundle(bundle.origin, at)
    return {'id':f'platform:{bundle.pk}','digest':bundle.digest,'content':bundle.content,
            'publication_id':bundle.origin.publication.pk,'max_age_seconds':bundle.origin.max_age_seconds,
            'platform_bundle_id':bundle.pk,'tenant_selection_id':choice.pk}
