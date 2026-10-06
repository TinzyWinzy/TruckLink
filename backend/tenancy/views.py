from django.db import transaction
from django.core.exceptions import ValidationError
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from core.audit import append_audit
from trip.models import Organisation
from trip.permissions import get_user_organisation, get_user_role, user_facilities
from regulatory.engine.evaluator import digest
from .models import TenantConfiguration
from .configuration import resolved


@api_view(['GET','POST'])
@permission_classes([IsAuthenticated])
def configuration(request):
    org = get_user_organisation(request.user)
    if org is None or get_user_role(request.user) is None:
        return Response({'error':'Tenant identity required'},status=403)
    if request.method == 'GET':
        return Response({'configuration':resolved(org)})
    if get_user_role(request.user) != 'ADMIN':
        return Response({'error':'Tenant administrator required'},status=403)
    try:
        with transaction.atomic():
            Organisation.objects.select_for_update().get(pk=org.pk)
            current = resolved(org)
            if type(request.data.get('expected_version')) is not int or request.data['expected_version'] != current['version']:
                return Response({'error':'Configuration changed; refresh before saving'},status=409)
            proposed = request.data.get('content')
            if not request.user.is_superuser and isinstance(proposed,dict) and proposed.get('integrations') != current['content']['integrations']:
                return Response({'error':'Integration credential bindings require a platform operator'},status=403)
            row = TenantConfiguration(organisation=org,version=current['version']+1,creator=request.user,
                                      content=request.data.get('content'),reason=request.data.get('reason',''))
            row.digest = digest(row.content)
            row.save()
            for yard in user_facilities(request.user).filter(organisation=org,is_deleted=False).order_by('pk'):
                append_audit(facility=yard,actor=request.user,action='CONFIGURE_TENANT',payload={'version':row.version,'digest':row.digest,'reason':row.reason})
        return Response({'configuration':resolved(org)},status=201)
    except (ValidationError,TypeError,AttributeError) as exc:
        return Response({'error':'; '.join(exc.messages) if isinstance(exc,ValidationError) else 'Invalid configuration document'},status=400)
