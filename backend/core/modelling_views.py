from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from tenancy.access import ModuleAccess
from rest_framework.response import Response
from trip.permissions import get_user_role, get_user_organisation
from core.audit_views import find_facility
from regulatory.modelling import run_model


@api_view(['POST'])
@permission_classes([IsAuthenticated,ModuleAccess])
def model_workspace(request):
    org = get_user_organisation(request.user)
    if not org or get_user_role(request.user) not in ('ADMIN','EXECUTIVE','FACILITY_MANAGER'):
        return Response({'error':'Modelling requires a tenant administrator or manager.'},status=403)
    facility = find_facility(str(request.data.get('facility','')),request.user)
    if not facility or facility.organisation_id != org.id:
        return Response({'error':'Yard not found.'},status=404)
    limits = {'seed':(0,2147483647,42),'vehicles':(1,300,72),'docks':(1,12,3),
              'arrivals_per_hour':(1,120,18),'service_minutes':(1,120,12)}
    values = {}
    for key,(low,high,default) in limits.items():
        raw = request.data.get(key,default)
        if isinstance(raw,bool) or not isinstance(raw,int) or not low <= raw <= high:
            return Response({'error':f'{key} must be an integer from {low} to {high}.'},status=400)
        values[key] = raw
    return Response({'organisation':{'id':org.id,'name':org.name},
                     'facility':{'id':facility.id,'name':facility.name}, **run_model(**values)})
