"""Yard-scoped route previews, draft trips and reported-position evidence.

Reuses SpotterAI routing and Trip records without asserting release eligibility.
"""
import math
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.throttling import UserRateThrottle
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from core.audit import append_audit
from core.audit_views import find_facility
from core.models import Facility
from regulatory.engine.evaluator import digest
from regulatory.models import OperationalContext, InspectionAttempt
from trip.models import Trip, Vehicle, Driver, UserRole
from trip.permissions import get_user_organisation, get_user_role
import geocoding
import routing

WRITERS = {UserRole.ADMIN, UserRole.DISPATCH_SUPERVISOR, UserRole.OPERATIONS_SUPERVISOR, UserRole.FACILITY_MANAGER}


class RouteCommandThrottle(UserRateThrottle):
    scope = 'route_command'
    rate = '30/hour'


class RouteInput(serializers.Serializer):
    origin = serializers.CharField(max_length=200)
    destination = serializers.CharField(max_length=200)
    waypoints = serializers.ListField(child=serializers.CharField(max_length=200), max_length=8, default=list)
    route_type = serializers.ChoiceField(choices=['DOMESTIC','CROSS_BORDER','ABNORMAL'])
    jurisdictions = serializers.ListField(child=serializers.RegexField(r'^[A-Z0-9_-]{2,32}$'), min_length=1, max_length=10)
    vehicle_id = serializers.IntegerField(min_value=1, allow_null=True, required=False)
    driver_id = serializers.IntegerField(min_value=1, allow_null=True, required=False)
    client_key = serializers.CharField(max_length=64, required=False)

    def validate(self, data):
        codes = data['jurisdictions']
        if len(set(codes)) != len(codes):
            raise serializers.ValidationError('Declare each jurisdiction once.')
        if data['route_type'] == 'DOMESTIC' and len(codes) != 1:
            raise serializers.ValidationError('Domestic routes require one declared jurisdiction.')
        if data['route_type'] == 'CROSS_BORDER' and len(codes) < 2:
            raise serializers.ValidationError('Cross-border routes require all traversed jurisdictions.')
        return data


def site(request):
    org = get_user_organisation(request.user)
    if not org or not get_user_role(request.user):
        return None
    ref = request.query_params.get('facility') if request.method == 'GET' else request.data.get('facility')
    yard = find_facility(str(ref or ''), request.user)
    return yard if yard and yard.organisation_id == org.id else None


def valid_point(lon, lat):
    return all(isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n) for n in (lon, lat)) and -180 <= lon <= 180 and -90 <= lat <= 90


def preview(data):
    stops = []
    labels = [data['origin'], *data['waypoints'], data['destination']]
    for index, label in enumerate(labels):
        point = geocoding.geocode(label)
        if not isinstance(point, dict) or not valid_point(point.get('lon'), point.get('lat')):
            raise ValueError(f'Could not resolve stop {index + 1}: {label}.')
        stops.append({'label':label,'lon':point['lon'],'lat':point['lat'],
                      'kind':'origin' if index == 0 else 'destination' if index == len(labels)-1 else 'waypoint'})
    route = routing.route([(s['lon'],s['lat']) for s in stops])
    if not isinstance(route, dict) or not route:
        raise ValueError('The routing provider is unavailable. No draft has been saved.')
    geometry = route.get('geometry', {})
    coords = geometry.get('coordinates', []) if isinstance(geometry, dict) else []
    distance = route.get('distance_meters'); duration = route.get('duration_seconds')
    if not isinstance(geometry, dict) or geometry.get('type') != 'LineString' or not isinstance(coords, list) or len(coords) < 2 or any(not isinstance(c,list) or len(c) < 2 or not valid_point(c[0],c[1]) for c in coords):
        raise ValueError('The routing provider returned invalid route geometry.')
    if any(not isinstance(n,(int,float)) or isinstance(n,bool) or not math.isfinite(n) or n < 0 for n in (distance,duration)):
        raise ValueError('The routing provider returned invalid distance or duration.')
    return {'stops':stops,'geometry':geometry,'distance_km':round(distance/1000,1),
            'duration_hours':round(duration/3600,2),'route_type':data['route_type'],
            'jurisdictions':data['jurisdictions'],'jurisdiction_source':'User declaration; not inferred from map labels',
            'provider':'OSRM public demo','profile':'driving','generated_at':timezone.now().isoformat(),
            'heavy_vehicle_suitability':'UNVERIFIED','regulatory_clearance':'NOT_EVALUATED',
            'input_digest':digest({k:v for k,v in data.items() if k != 'client_key'})}


def row(trip, context=None):
    position = trip.positions.order_by('-timestamp','-pk').first()
    latest = InspectionAttempt.objects.filter(context=context).order_by('-created_at','-pk').first() if context else None
    now = timezone.now()
    pos = None
    if position and valid_point(position.lon,position.lat):
        age = max(0,int((now-position.timestamp).total_seconds()))
        pos = {'lat':position.lat,'lon':position.lon,'timestamp':position.timestamp.isoformat(),
               'source':position.source,'accuracy':position.accuracy,'age_seconds':age,'stale':age > 300}
    return {'id':trip.id,'origin':trip.origin,'destination':trip.destination,'status':trip.status,
            'vehicle':{'id':trip.vehicle_id,'plate':trip.vehicle.plate} if trip.vehicle else None,
            'driver':{'id':trip.driver_id,'name':trip.driver.name} if trip.driver else None,
            'routing':trip.routing_snapshot or {'geometry':trip.route_geometry,'stops':[],
                'distance_km':trip.distance_km,'duration_hours':None,'provider':'Legacy route; source unrecorded',
                'jurisdictions':context.jurisdictions if context else [], 'regulatory_clearance':'NOT_EVALUATED'},
            'position':pos, 'context':{'id':context.id,'queue_entry':str(context.queue_entry_id),
                'jurisdictions':context.jurisdictions,'route_type':context.route_type,
                'latest_decision':latest.decision if latest else None,
                'attempt_id':latest.pk if latest else None,
                'rulesets':latest.ruleset_snapshot if latest else []} if context else None,
            'synthetic':False}


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def route_workspace(request):
    yard = site(request)
    if not yard:
        return Response({'error':'Yard not found.'},status=404)
    contexts = list(OperationalContext.objects.filter(organisation=yard.organisation, queue_entry__facility=yard).order_by('-created_at','-pk'))
    by_trip = {}
    for ctx in contexts:
        by_trip.setdefault(ctx.trip_id,ctx)
    trips = Trip.objects.filter(organisation=yard.organisation).filter(Q(facility=yard) | Q(facility__isnull=True,pk__in=by_trip)).select_related('vehicle','driver').order_by('-created_at')[:100]
    return Response({'organisation':{'id':yard.organisation_id,'name':yard.organisation.name},
        'facility':{'id':yard.id,'name':yard.name},'trips':[row(t,by_trip.get(t.id)) for t in trips],
        'vehicles':list(Vehicle.objects.filter(organisation=yard.organisation,is_deleted=False).values('id','plate')),
        'drivers':list(Driver.objects.filter(organisation=yard.organisation,is_deleted=False).values('id','name')),
        'can_save':get_user_role(request.user) in WRITERS})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([RouteCommandThrottle])
def route_command(request, save=False):
    yard = site(request)
    if not yard:
        return Response({'error':'Yard not found.'},status=404)
    if save and get_user_role(request.user) not in WRITERS:
        return Response({'error':'Your working role cannot save draft routes.'},status=403)
    serializer = RouteInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    entities = {}
    for key, model in [('vehicle_id',Vehicle),('driver_id',Driver)]:
        entity = model.objects.filter(pk=data.get(key),organisation=yard.organisation,is_deleted=False).first() if data.get(key) else None
        if data.get(key) and not entity:
            return Response({'error':'Assigned vehicle or driver not found in this tenant.'},status=404)
        entities[key[:-3]] = entity
    key = data.get('client_key','')
    fingerprint = digest({k:v for k,v in data.items() if k != 'client_key'})
    if save and not key:
        return Response({'error':'A replay key is required to save a draft.'},status=400)
    old = Trip.objects.filter(facility=yard,route_client_key=key).first() if save else None
    if old:
        if old.routing_snapshot.get('input_digest') != fingerprint:
            return Response({'error':'Replay key conflicts with another route.'},status=409)
        return Response({'trip':row(old),'replayed':True})
    try:
        result = preview(data)
    except ValueError as exc:
        return Response({'error':str(exc)},status=502)
    if not save:
        return Response({'routing':result,'synthetic':False})
    with transaction.atomic():
        Facility.objects.select_for_update().get(pk=yard.pk)
        for entity in entities.values():
            if entity and not type(entity).objects.filter(pk=entity.pk,organisation=yard.organisation,is_deleted=False).exists():
                return Response({'error':'Assigned vehicle or driver is no longer available in this tenant.'},status=409)
        old = Trip.objects.filter(facility=yard,route_client_key=key).first()
        if old:
            if old.routing_snapshot.get('input_digest') != fingerprint:
                return Response({'error':'Replay key conflicts with another route.'},status=409)
            return Response({'trip':row(old),'replayed':True})
        trip = Trip.objects.create(organisation=yard.organisation,facility=yard,origin=data['origin'],
            destination=data['destination'],waypoints=data['waypoints'],route_geometry=result['geometry'],
            distance_km=result['distance_km'],waypoints_geocoded=result['stops'][1:-1],
            routing_snapshot=result,route_client_key=key,**entities)
        append_audit(facility=yard,actor=request.user,action='SAVE_ROUTE_DRAFT',payload={'trip_id':trip.id,'routing_digest':digest(result)})
    return Response({'trip':row(trip),'replayed':False},status=201)
