from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from trip.models import Trip
from yard.models import QueueEntry
from core.audit_views import find_facility
from regulatory.models import ReleaseRecord
from .models import JourneyLink,JourneyEvent
from .services import authorize, link_visit, record_event
import json
from yard.models import AuditLog


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def delivery_workspace(request):
    """Origin-site board. Reuses authoritative journey state; GET never records events."""
    facility = find_facility(str(request.query_params.get('facility', '')), request.user)
    if not facility:
        return Response({'detail': 'Site not found'}, status=404)
    try:
        authorize(request.user, facility, 'read')
    except PermissionError as exc:
        return Response({'detail': str(exc)}, status=403)
    try:
        page = max(1, int(request.query_params.get('page', '1')))
    except ValueError:
        return Response({'detail': 'Page must be an integer'}, status=400)
    links = JourneyLink.objects.filter(organisation=facility.organisation, facility=facility).select_related(
        'trip__vehicle', 'trip__driver', 'visit__assigned_dock', 'facility').order_by('-pk')
    query = request.query_params.get('q', '').strip()[:100]
    if query:
        from django.db.models import Q
        links = links.filter(Q(visit__reg_number__icontains=query) | Q(trip__destination__icontains=query)
                             | Q(trip__driver__name__icontains=query) | Q(external_reference__icontains=query))
    total = links.count()
    from trip.route_views import row
    records = []
    for link in links[(page-1)*20:page*20]:
        journey = timeline(link, request.user, include_history=False)
        records.append({'trip': row(link.trip), 'journey': {key: journey[key] for key in (
            'trip_id', 'visit_id', 'stage', 'next_action', 'delivery_stops', 'returns', 'closure',
            'integrations', 'physical_exit_at', 'position')}})
    return Response({'records': records, 'total': total, 'page': page, 'page_size': 20,
        'as_of': timezone.now(), 'facility': {'id': facility.pk, 'name': facility.name},
        'organisation': {'id': facility.organisation_id, 'name': facility.organisation.name},
        'scope': 'Linked journeys originating at the selected yard. ERP and commercial closure are separate.'})


class LinkInput(serializers.Serializer):
    facility = serializers.CharField()
    visit_id = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(max_length=1000)
    external_system = serializers.CharField(max_length=80,required=False,default='',allow_blank=True)
    external_reference = serializers.CharField(max_length=120,required=False,default='',allow_blank=True)


class EventInput(serializers.Serializer):
    kind = serializers.ChoiceField(choices=[v for v,_ in JourneyEvent._meta.get_field('kind').choices])
    observed_at = serializers.DateTimeField()
    client_key = serializers.CharField(max_length=64)
    reason = serializers.CharField(max_length=1000)
    details = serializers.DictField(required=False,default=dict)
    stop_index = serializers.IntegerField(min_value=0,required=False,allow_null=True,default=None)
    return_order_id = serializers.IntegerField(min_value=1,required=False,allow_null=True,default=None)
    receiving_visit_id = serializers.IntegerField(min_value=1,required=False,allow_null=True,default=None)

    def validate(self,data):
        details = data['details']
        if data['kind'] in ('DELIVERY_ACCEPTED','DELIVERY_REJECTED','RETURN_RECEIVED'):
            if set(details) != {'receiver','evidence_reference','evidence_sha256'}:
                raise serializers.ValidationError('Delivery requires receiver, evidence_reference and evidence_sha256')
            if any(not isinstance(v,str) or not v.strip() or len(v)>300 for v in details.values()):
                raise serializers.ValidationError('Delivery evidence fields must be non-empty text')
            sha = details['evidence_sha256']
            if len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha):
                raise serializers.ValidationError('Evidence digest must be SHA-256 hex')
        elif details:
            raise serializers.ValidationError('This observation accepts no additional evidence fields')
        return data


def journey_history(link):
    visit, trip = link.visit, link.trip
    events = [{'id':f'visit:{visit.pk}','kind':'REGISTERED','at':visit.entry_timestamp,'actor_id':visit.created_by_id}]
    for audit in AuditLog.objects.filter(organisation=link.organisation,facility=link.facility,action='ASSIGN_DOCK').order_by('timestamp'):
        try: payload = json.loads(audit.payload)
        except (ValueError,TypeError): continue
        if isinstance(payload,dict) and str(payload.get('queueEntryId')) == str(visit.pk):
            events.append({'id':f'dock:{audit.pk}','kind':'DOCK_ASSIGNED','at':audit.timestamp,
                'actor_id':audit.actor_id,'dock_id':payload.get('dockId')})
    for attempt in visit.inspection_attempts.order_by('created_at','pk'):
        events.append({'id':f'inspection:{attempt.pk}','kind':'INSPECTION','at':attempt.created_at,
            'actor_id':attempt.creator_id,'decision':attempt.decision,'context_id':attempt.context_id})
    releases=ReleaseRecord.objects.filter(queue_entry=visit).order_by('created_at','pk')
    for release in releases:
        events.append({'id':f'release:{release.pk}','kind':'YARD_RELEASE_AUTHORISED','at':release.created_at,
            'actor_id':release.creator_id,'attempt_id':release.attempt_id,'approval_id':release.approval_id})
        if hasattr(release,'withdrawal'):
            withdrawal=release.withdrawal
            events.append({'id':f'withdrawal:{withdrawal.pk}','kind':'RELEASE_WITHDRAWN','at':withdrawal.created_at,
                'actor_id':withdrawal.creator_id,'reason':withdrawal.reason,'release_id':release.pk})
    if not releases.exists() and visit.status == 'RELEASED':
        events.append({'id':f'demo-release:{visit.pk}','kind':'LEGACY_DEMO_RELEASE_UNVERIFIED',
            'at':visit.release_authorized_at or visit.exit_timestamp,'actor_id':None})
    for event in link.events.order_by('observed_at','pk'):
        events.append({'id':f'journey:{event.pk}','kind':event.kind,'at':event.observed_at,
            'recorded_at':event.created_at,'actor_id':event.creator_id,'reason':event.reason,
            'details':event.details,'stop_index':event.stop_index,'return_order_id':event.return_order_id,
            'receiving_visit_id':event.receiving_visit_id,'source':'Staff attestation; external evidence not independently verified'})
    for plan in link.delivery_plans.order_by('version'):
        events.append({'id':f'plan:{plan.pk}','kind':'DELIVERY_PLAN_RECORDED','at':plan.created_at,
            'actor_id':plan.creator_id,'reason':f'Version {plan.version}: {plan.reason}'})
    for order in link.returns.order_by('pk'):
        events.append({'id':f'return:{order.pk}','kind':'RETURN_AUTHORISED','at':order.created_at,
            'actor_id':order.creator_id,'reason':order.reason,'return_order_id':order.pk,'stop_index':order.rejection.stop_index})
    return events


def timeline(link,actor=None,include_history=True):
    visit, trip = link.visit, link.trip
    events = journey_history(link) if include_history else []
    releases = ReleaseRecord.objects.filter(queue_entry=visit)
    dock_occupied = bool(visit.assigned_dock_id and visit.assigned_dock.current_entry_id == visit.pk)
    position = trip.positions.order_by('-timestamp','-pk').first()
    departure = link.events.filter(kind='DEPARTED').first()
    from .execution import delivery_state,itinerary
    state=delivery_state(link)
    if not departure:
        stage='YARD_RELEASE_AUTHORISED' if visit.status=='RELEASED' else 'AT_ORIGIN'
    elif state['active'] is not None:
        prior=state['active']['latest']; stage=prior.kind if prior else 'DEPARTED'
    else:
        stage='DELIVERY_ACCEPTED' if state['all_accepted'] else 'STOPS_COMPLETE_RETURNS_OPEN' if state['open_returns'] else 'COMPLETED_WITH_RETURNS'
    return_rows=[]
    for row in state['returns']:
        latest_return=row.events.order_by('-observed_at','-pk').first()
        return_rows.append({'id':row.pk,'rejection_id':row.rejection_id,'stop_index':row.rejection.stop_index,
            'facility_id':row.facility_id,'facility_name':row.facility.name,'reason':row.reason,
            'consignments':row.consignments,'route_reference':row.route_reference,'jurisdictions':row.jurisdictions,
            'state':latest_return.kind if latest_return else 'RETURN_AUTHORISED','clearance':'NOT_EVALUATED'})
    profile_facilities=actor.profile.facilities.filter(organisation=link.organisation,is_deleted=False) if actor else [link.facility]
    receiving=[]
    for row in QueueEntry.objects.filter(organisation=link.organisation,facility__in=profile_facilities,
            reg_number__iexact=visit.reg_number).exclude(pk=visit.pk).exclude(status='RELEASED').order_by('-entry_timestamp')[:100]:
        if departure and row.entry_timestamp>=departure.observed_at:
            receiving.append({'id':row.pk,'facility_id':row.facility_id,'reg_number':row.reg_number})
    return {'id':link.pk,'trip_id':trip.pk,'visit_id':visit.pk,'facility_id':link.facility_id,
        'stage':stage,'milestone_semantics':visit.milestone_semantics,'dock_occupied':dock_occupied,
        'release_authorized_at':visit.release_authorized_at,'dock_vacated_at':visit.dock_vacated_at,
        'physical_exit_at':departure.observed_at if departure else None,
        'next_action':next_action(link,stage,dock_occupied),
        'delivery_plan':{'id':state['plan'].pk,'version':state['plan'].version,'stops':state['plan'].stops} if state['plan'] else None,
        'delivery_stops':state['stops'],'active_stop_index':state['active']['index'] if state['active'] else None,
        'active_rejection_id':state['active']['latest'].pk if state['active'] and state['active']['latest'] and state['active']['latest'].kind=='DELIVERY_REJECTED' else None,
        'itinerary':itinerary(link),'returns':return_rows,'receiving_visits':receiving,
        'return_sites':[{'id':site.pk,'name':site.name} for site in profile_facilities],
        'can_withdraw_release':visit.milestone_semantics=='SEPARATE_V1' and visit.status=='RELEASED' and not departure and releases.filter(withdrawal__isnull=True).exists(),
        'closure':{'physical_delivery':'ACCEPTED' if stage=='DELIVERY_ACCEPTED' else 'COMPLETED_WITH_RETURNS' if stage=='COMPLETED_WITH_RETURNS' else 'OPEN',
            'evidence':'REFERENCE_RECORDED_NOT_RECONCILED' if stage in ('DELIVERY_ACCEPTED','DELIVERY_REJECTED','DELIVERY_REATTEMPT_PLANNED','STOPS_COMPLETE_RETURNS_OPEN','COMPLETED_WITH_RETURNS') else 'AWAITING_DELIVERY',
            'erp':'NOT_CONFIGURED','commercial':'NOT_CONFIRMED'},
        'yard_status':visit.status,'dock':visit.assigned_dock.name if visit.assigned_dock_id else None,
        'assignment':link.assignment,'external_reference':{'system':link.external_system,'reference':link.external_reference,
            'verification':'MANUALLY_RECORDED'} if link.external_reference else None,
        'integrations':{'erp':'NOT_CONFIGURED','tracking':'NOT_CONFIGURED'},
        'position':{'lat':position.lat,'lon':position.lon,'at':position.timestamp,'source':position.source,
            'stale':(timezone.now()-position.timestamp).total_seconds()>300,'verification':'UNVERIFIED_REPORT'} if position else None,
        'events':sorted(events,key=lambda e:(e['at'],e['id']))}


def next_action(link, stage, dock_occupied):
    origin_roles = ['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER']
    destination_roles = ['OPERATIONS_SUPERVISOR','FACILITY_MANAGER']
    if stage == 'AT_ORIGIN' and link.visit.status in ('COMPLETED','OVERRIDE_APPROVED'):
        return {'kind':None,'label':'Authorise yard release','owner_roles':origin_roles,'href':'/queue','scope':None}
    if stage == 'AT_ORIGIN' and link.visit.status in ('QUARANTINED','PENDING_OVERRIDE'):
        return {'kind':None,'label':'Resolve the held inspection or independent approval',
            'owner_roles':['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR'],
            'href':f'/compliance?entry={link.visit_id}','scope':'A held inspection does not authorise release'}
    actions = {
        'AT_ORIGIN':(None,'Complete inspection and release approval',origin_roles,f'/compliance?entry={link.visit_id}'),
        'YARD_RELEASE_AUTHORISED':('DOCK_VACATED' if dock_occupied and link.visit.milestone_semantics=='SEPARATE_V1' else 'DEPARTED',
            'Confirm dock vacated' if dock_occupied and link.visit.milestone_semantics=='SEPARATE_V1' else 'Confirm physical gate exit',
            destination_roles if dock_occupied and link.visit.milestone_semantics=='SEPARATE_V1' else origin_roles,None),
        'DOCK_VACATED':('DEPARTED','Confirm physical gate exit',origin_roles,None),
        'DEPARTED':('DESTINATION_ARRIVED','Confirm destination arrival',destination_roles,None),
        'DESTINATION_ARRIVED':('DELIVERY_OUTCOME','Record receiver and delivery evidence',destination_roles,None),
        'DELIVERY_REJECTED':('DELIVERY_REATTEMPT_PLANNED','Plan a reattempt at the same destination',destination_roles,None),
        'DELIVERY_REATTEMPT_PLANNED':('DESTINATION_ARRIVED','Confirm arrival for the next delivery attempt',destination_roles,None),
        'DELIVERY_ACCEPTED':(None,'Reconcile retained evidence and ERP closure outside Trucki',destination_roles,None),
        'STOPS_COMPLETE_RETURNS_OPEN':(None,'Complete the authorised return movements and receiving evidence',destination_roles,None),
        'COMPLETED_WITH_RETURNS':(None,'Reconcile returned consignments with the ERP owner',destination_roles,None),
    }
    kind,label,roles,href = actions[stage]
    return {'kind':kind,'label':label,'owner_roles':roles,'href':href,
        'scope':'Same trip and destination; returns and destination changes require a separate operational plan' if stage=='DELIVERY_REJECTED' else None}


class PlanInput(serializers.Serializer):
    stops=serializers.JSONField()
    reason=serializers.CharField(max_length=1000)
    client_key=serializers.CharField(max_length=64)
    expected_version=serializers.IntegerField(min_value=0)


class ReturnInput(serializers.Serializer):
    rejection_id=serializers.IntegerField(min_value=1)
    facility_id=serializers.IntegerField(min_value=1)
    route_reference=serializers.CharField(max_length=300)
    route_sha256=serializers.RegexField(r'^[a-f0-9]{64}$')
    route_type=serializers.ChoiceField(choices=['DOMESTIC','CROSS_BORDER'])
    jurisdictions=serializers.ListField(child=serializers.CharField(max_length=20),allow_empty=False)
    reason=serializers.CharField(max_length=1000)
    client_key=serializers.CharField(max_length=64)


class WithdrawalInput(serializers.Serializer):
    reason=serializers.CharField(max_length=1000)
    client_key=serializers.CharField(max_length=64)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def journey_command(request,pk,command):
    from .execution import record_plan,authorise_return,withdraw_release
    form={'plan':PlanInput,'returns':ReturnInput,'withdraw-release':WithdrawalInput}[command](data=request.data)
    form.is_valid(raise_exception=True)
    link=JourneyLink.objects.select_related('visit','trip','facility').filter(trip_id=pk).first()
    if not link: return Response({'detail':'No linked origin visit'},status=404)
    try:
        {'plan':record_plan,'returns':authorise_return,'withdraw-release':withdraw_release}[command](request.user,link,**form.validated_data)
        return Response({'journey':timeline(link,request.user)})
    except PermissionError as exc: return Response({'detail':str(exc)},status=403)
    except ValidationError as exc: return Response({'detail':'; '.join(exc.messages)},status=409)


@api_view(['GET','POST'])
@permission_classes([IsAuthenticated])
def journey(request, pk):
    try:
        if request.method == 'POST':
            serializer = LinkInput(data=request.data); serializer.is_valid(raise_exception=True)
            data = dict(serializer.validated_data)
            facility = find_facility(data.pop('facility'),request.user)
            if not facility: return Response({'detail':'Site not found'},status=404)
            authorize(request.user,facility)
            trip = Trip.objects.filter(pk=pk,organisation=facility.organisation).first()
            visit = QueueEntry.objects.filter(pk=data.pop('visit_id'),facility=facility).first()
            if not trip or not visit: return Response({'detail':'Trip or visit not found'},status=404)
            link = link_visit(request.user,visit,trip,**data)
        else:
            link = JourneyLink.objects.select_related('visit','trip','facility').filter(trip_id=pk).first()
            if not link: return Response({'detail':'No linked origin visit'},status=404)
            authorize(request.user,link.facility,'read')
        return Response({'journey':timeline(link,request.user)})
    except PermissionError as exc:
        return Response({'detail':str(exc)},status=403)
    except ValidationError as exc:
        return Response({'detail':'; '.join(exc.messages)},status=409)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def journey_event(request, pk):
    serializer = EventInput(data=request.data); serializer.is_valid(raise_exception=True)
    link = JourneyLink.objects.select_related('facility','trip','visit').filter(trip_id=pk).first()
    if not link: return Response({'detail':'No linked origin visit'},status=404)
    try:
        event = record_event(request.user,link,**serializer.validated_data)
        return Response({'event_id':event.pk,'journey':timeline(link,request.user)})
    except PermissionError as exc: return Response({'detail':str(exc)},status=403)
    except ValidationError as exc: return Response({'detail':'; '.join(exc.messages)},status=409)
