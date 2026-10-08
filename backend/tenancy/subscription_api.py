from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from trip.models import Organisation
from trip.permissions import get_user_role, get_user_organisation, user_facilities
from core.audit import append_audit
from core.audit_views import resolve_facility
from core.rbac import rbac_allows
from .catalogue import catalogue, expand_modules
from .subscriptions import entitlement, configured_modules, effective_modules
from .models import TenantModuleSelection


class SelectionInput(serializers.Serializer):
    modules = serializers.ListField(child=serializers.CharField(),max_length=10)
    expected_version = serializers.IntegerField(min_value=0)
    reason = serializers.CharField(max_length=1000)


def selection_output(row):
    return {'version':row.version,'modules':row.modules,'required_modules':expand_modules(row.modules),
        'created_at':row.created_at.isoformat(),'status':'REQUESTED'} if row else None


@api_view(['GET','POST'])
@permission_classes([IsAuthenticated])
def subscription(request):
    org = get_user_organisation(request.user)
    if not org or get_user_role(request.user) != 'ADMIN':
        return Response({'error':'Tenant administrator required'},status=403)
    if request.method == 'POST':
        if set(request.data) - {'modules','expected_version','reason'}:
            return Response({'error':'Only module choices, version and reason are accepted'},status=400)
        form = SelectionInput(data=request.data); form.is_valid(raise_exception=True)
        data = form.validated_data
        try:
            expand_modules(data['modules'])
            with transaction.atomic():
                Organisation.objects.select_for_update().get(pk=org.pk)
                latest = TenantModuleSelection.objects.filter(organisation=org).order_by('-version').first()
                if data['expected_version'] != (latest.version if latest else 0):
                    return Response({'error':'Module selection changed; reload before saving'},status=409)
                row = TenantModuleSelection.objects.create(organisation=org,version=data['expected_version']+1,
                    modules=sorted(set(data['modules']) | {'audit'}),reason=data['reason'],creator=request.user)
                for site in user_facilities(request.user).filter(organisation=org,is_deleted=False):
                    append_audit(facility=site,actor=request.user,action='REQUEST_TENANT_MODULES',payload={
                        'selection_id':row.pk,'version':row.version,'modules':row.modules,'required_modules':expand_modules(row.modules),
                        'reason':data['reason'],'previous_version':latest.version if latest else None,'new_state':'REQUESTED'})
        except ValidationError as exc:
            return Response({'error':'; '.join(exc.messages)},status=400)
    latest = TenantModuleSelection.objects.filter(organisation=org).order_by('-version').first()
    response = Response({'organisation':{'id':org.pk,'name':org.name},'catalogue':catalogue(),
        'selection':selection_output(latest),'entitlement':entitlement(org),'configured_modules':configured_modules(org),
        'effective_modules':effective_modules(org),'billing':{'mode':'OPERATOR_APPROVED','prices_defined':False,'checkout_available':False},
        'unavailable':[{'key':'tracking','name':'Connected fleet tracking','reason':'Tracker adapters require discovery and implementation; not offered as an active module.'}]},
        status=201 if request.method == 'POST' else 200)
    response['Cache-Control'] = 'private, no-store'
    return response


# Only implemented screens. No inaccessible or speculative widgets are generated.
CARDS = [
    ('dispatch','yard','compliance','Dispatch preparation','Prepare vehicle, driver, trip, load and inspection context.','/dispatch',{'ADMIN','DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','COMPLIANCE_OFFICER','EXECUTIVE'}),
    ('docks','docks','docks','Dock operations','Assign loading positions and manage current occupancy.','/docks',{'OPERATIONS_SUPERVISOR','FACILITY_MANAGER'}),
    ('dock_setup','docks','admin','Dock setup','Configure confirmed site docks and capacity.','/admin',{'ADMIN'}),
    ('approvals','inspection','compliance','Pending approvals','Resolve reviews using separate authorized identities.','/approvals',{'ADMIN','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','COMPLIANCE_OFFICER'}),
    ('deliveries','routing','routes','Deliveries & exceptions','Follow destinations, reattempts and returns.','/deliveries',{'ADMIN','DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','COMPLIANCE_OFFICER','EXECUTIVE'}),
    ('consignments','routing','routes','Customer consignments','Connect an order to its allocated loads and accepted quantities.','/consignments',{'ADMIN','DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','COMPLIANCE_OFFICER','EXECUTIVE'}),
    ('graphs','reports','reports','Activity intelligence','Recorded yard graphs, trends and source coverage.','/reports',{'ADMIN','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','EXECUTIVE'}),
    ('fleet','fleet','admin','Fleet setup','Register confirmed vehicles and driver records.','/admin',{'ADMIN'}),
    ('modelling','modelling','reports','Synthetic scenarios','Explore assumptions without operational writes.','/modelling',{'ADMIN','EXECUTIVE','FACILITY_MANAGER'}),
    ('audit','audit','audit','Audit & history','Inspect accountable records within your assigned site.','/audit',{'ADMIN','EXECUTIVE','FACILITY_MANAGER','COMPLIANCE_OFFICER'}),
]


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def workspace(request):
    site, error = resolve_facility(request)
    if error is not None:
        return error
    org, role = site.organisation, get_user_role(request.user)
    enabled = effective_modules(org)
    cards = [{'key':key,'module':module,'title':title,'description':description,'href':href}
        for key,module,resource,title,description,href,roles in CARDS
        if role in roles and enabled[module] and rbac_allows(role,resource,'read',org,site)]
    from .releases import active_release
    release = active_release(org)
    response = Response({'organisation':{'id':org.pk,'name':org.name},'facility':{'id':site.pk,'name':site.name},
        'role':role,'as_of':timezone.now().isoformat(),'modules':enabled,'cards':cards,
        'activation_required':org.requires_release and release is None,
        'notice':'Workspace uses effective module access, role permissions and the selected site. Data availability is shown inside each module.'})
    response['Cache-Control'] = 'private, no-store'
    return response
