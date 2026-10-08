"""Module checks cover authenticated API commands, including legacy entry points."""
from rest_framework.permissions import BasePermission
from rest_framework.exceptions import PermissionDenied
from .releases import module_enabled


def enforce_request(user,request):
    if request.method in ('GET','HEAD','OPTIONS'):
        return  # Disabled modules retain authorized historical reads.
    from trip.permissions import get_user_organisation
    org = get_user_organisation(user)
    if not org:
        return
    path = request.path
    module = None
    if '/api/routes/' in path or '/route-plan' in path or '/api/consignments/' in path:
        module = 'routing'
    elif '/api/regulatory/' in path and not any(x in path for x in ('knowledge','governance-audit','platform-catalogue','tenant-selections')):
        module = 'release' if 'override' in path else 'inspection'
    elif '/api/compliance/' in path:
        module = 'release' if 'override' in path else 'inspection'
    elif '/api/queue/' in path:
        module = 'release' if 'release' in path else 'yard'
    elif '/api/docks/' in path or '/api/equipment/' in path:
        module = 'docks'
    elif '/api/modelling/' in path:
        module = 'modelling'
    elif any(x in path for x in ('/api/trip/','/api/trips','/api/vehicles','/api/drivers','/api/fuel','/api/public/book','/api/bookings','/api/admin/trips')):
        module = 'fleet'
    if module and not module_enabled(org,module):
        raise PermissionDenied(f'Tenant module {module} is disabled')
    if path in ('/api/trip/','/api/trip/estimate/','/api/routes/preview/','/api/routes/drafts/'):
        if not module_enabled(org,'routing'):
            raise PermissionDenied('Tenant module routing is disabled')
        from .integrations import adapter_enabled
        if not adapter_enabled(org,'road-routing-v1'):
            raise PermissionDenied('Tenant road-routing adapter is disabled')


class ModuleAccess(BasePermission):
    def has_permission(self,request,view):
        enforce_request(request.user,request)
        return True
