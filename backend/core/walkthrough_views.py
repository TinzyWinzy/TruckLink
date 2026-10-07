"""Read-only, site-scoped operational readiness for self-guided reviewers."""
from rest_framework.decorators import api_view,permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from core.audit_views import find_facility
from journeys.services import authorize
from trip.models import Vehicle,Driver
from yard.models import QueueEntry
from regulatory.models import Load,VehicleConfiguration
from tenancy.configuration import resolved


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def walkthrough(request):
    site=find_facility(request.query_params.get('facility',''),request.user)
    if not site: return Response({'detail':'Assigned site not found'},status=404)
    try: authorize(request.user,site,'read')
    except PermissionError as exc: return Response({'detail':str(exc)},status=403)
    org=site.organisation
    entries=QueueEntry.objects.filter(facility=site,organisation=org)
    config=resolved(org,facility=site)
    return Response({'organisation':{'id':org.pk,'name':config['content']['branding']['display_name'] or org.name},
        'facility':{'id':site.pk,'name':site.name},'modules':config['modules'],
        'counts':{'vehicles':Vehicle.objects.filter(organisation=org,is_deleted=False).count(),
            'drivers':Driver.objects.filter(organisation=org,is_deleted=False).count(),
            'loads':Load.objects.filter(organisation=org).count(),
            'configuration_records':VehicleConfiguration.objects.filter(organisation=org).count(),
            'visits':entries.count(),'linked_journeys':entries.filter(journey_link__isnull=False).count()},
        'visits':[{'id':v.pk,'plate':v.reg_number,'status':v.status} for v in entries.order_by('-entry_timestamp')[:30]],
        'integrations':{'erp':'NOT_CONFIGURED','tracker':'NOT_CONFIGURED'},
        'notice':'Record counts do not establish evidence validity or release eligibility. Open a visit to inspect its owned prerequisites.'})
