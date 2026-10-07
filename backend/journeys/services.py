from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from core.audit import append_audit
from core.models import Facility
from core.rbac import rbac_allows
from trip.permissions import get_user_role
from trip.models import Trip, TripStatusLog
from yard.models import QueueEntry, Dock
from .models import JourneyLink, JourneyEvent
from regulatory.engine.evaluator import digest


def authorize(actor, facility, action='create'):
    from tenancy.releases import module_enabled
    profile = getattr(actor,'profile',None)
    if (not profile or profile.organisation_id != facility.organisation_id
            or not profile.facilities.filter(pk=facility.pk,is_deleted=False).exists()
            or not rbac_allows(get_user_role(actor),'routes',action,facility.organisation,facility)):
        raise PermissionError('Journey access is not permitted for your role or site')
    if action != 'read' and not module_enabled(facility.organisation,'fleet'):
        raise PermissionError('Tenant fleet module is disabled')


def assignment(trip):
    return {'vehicle_id':trip.vehicle_id,'driver_id':trip.driver_id,'origin':trip.origin,
            'destination':trip.destination,'waypoints':trip.waypoints}


@transaction.atomic
def link_visit(actor, visit, trip, reason, external_system='', external_reference=''):
    # Match yard/context lock order: visit -> facility -> trip.
    visit = QueueEntry.objects.select_for_update().get(pk=visit.pk)
    facility = Facility.objects.select_for_update().get(pk=visit.facility_id)
    authorize(actor,facility)
    trip = Trip.objects.select_for_update().get(pk=trip.pk)
    old = JourneyLink.objects.filter(visit=visit).first()
    if old:
        if (old.trip_id,old.external_system,old.external_reference) != (trip.pk,external_system,external_reference):
            raise ValidationError('Visit is already linked; historical identity cannot be replaced')
        return old
    if visit.status == 'RELEASED' or trip.status in ('dispatched','at_border','in_transit','delivered','returned','paid','cancelled'):
        raise ValidationError('Link the origin visit before release or journey execution')
    if visit.regulatory_contexts.exclude(trip=trip).exists():
        raise ValidationError('Visit already has an inspection context for another trip')
    row = JourneyLink.objects.create(organisation=visit.organisation,facility=facility,
        trip=trip,visit=visit,assignment=assignment(trip),creator=actor,reason=reason,
        external_system=external_system,external_reference=external_reference)
    visit.milestone_semantics = 'SEPARATE_V1'
    visit.save(update_fields=['milestone_semantics','updated_at'])
    append_audit(facility=facility,actor=actor,action='LINK_JOURNEY',
        payload={'journey_id':row.pk,'trip_id':trip.pk,'queue_entry_id':visit.pk,'reg_number':visit.reg_number,'reason':reason,
            'assignment_digest':digest(row.assignment),'external_system':external_system,'external_reference':external_reference})
    return row


def check_assignment(link):
    if assignment(link.trip) != link.assignment:
        raise ValidationError('Journey assignment changed; retain this record and resolve the assignment before departure')
    link.full_clean()


@transaction.atomic
def record_event(actor, link, *, kind, observed_at, details, client_key, reason, stop_index=None, return_order_id=None, receiving_visit_id=None):
    visit = QueueEntry.objects.select_for_update().get(pk=link.visit_id)
    Facility.objects.select_for_update().get(pk=link.facility_id)
    trip = Trip.objects.select_for_update().get(pk=link.trip_id)
    link.trip = trip
    link.visit = visit
    authorize(actor,link.facility)
    role = get_user_role(actor)
    origin_event = kind in ('DOCK_VACATED','DEPARTED')
    if origin_event and role not in ('DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER'):
        raise PermissionError('Select an authorised departure working role')
    if not origin_event and role not in ('OPERATIONS_SUPERVISOR','FACILITY_MANAGER'):
        raise PermissionError('Only authorised operations staff may attest destination events')
    if kind == 'DOCK_VACATED' and not rbac_allows(role,'docks','update',link.organisation,link.facility):
        raise PermissionError('Dock vacancy requires authorised dock operations permission')
    from .execution import delivery_state,DELIVERY_KINDS,RETURN_KINDS
    from .models import ReturnOrder
    returning=kind in RETURN_KINDS
    order=ReturnOrder.objects.filter(pk=return_order_id,journey=link).first() if return_order_id else None
    if returning:
        if not order: raise ValidationError('Choose an authorised return on this journey')
        stop_index=order.rejection.stop_index
    elif return_order_id or receiving_visit_id:
        raise ValidationError('Return references are only accepted on return events')
    old = link.events.filter(client_key=client_key).first()
    if old:
        if (old.kind,old.observed_at,old.details,old.reason,old.stop_index,old.return_order_id,old.receiving_visit_id,old.creator_id) != (kind,observed_at,details,reason,stop_index,return_order_id,receiving_visit_id,actor.pk):
            raise ValidationError('Replay key conflicts with a different event')
        return old
    if observed_at > timezone.now() or observed_at < visit.entry_timestamp:
        raise ValidationError('Observation must be after registration and cannot be in the future')
    previous = link.events.order_by('-observed_at','-pk').first()
    state=delivery_state(link)
    if kind in DELIVERY_KINDS:
        active=state['active']
        if not link.events.filter(kind='DEPARTED').exists() or not active or active['index']!=stop_index:
            raise ValidationError('Choose the current delivery stop after confirmed departure')
        prior=active['latest']
        allowed={None:['DESTINATION_ARRIVED'],'DESTINATION_ARRIVED':['DELIVERY_ACCEPTED','DELIVERY_REJECTED'],
            'DELIVERY_REJECTED':['DELIVERY_REATTEMPT_PLANNED'],'DELIVERY_REATTEMPT_PLANNED':['DESTINATION_ARRIVED']}
        if kind not in allowed.get(prior.kind if prior else None,[]):
            raise ValidationError('Delivery event is out of sequence')
    elif returning:
        prior=order.events.order_by('-observed_at','-pk').first()
        expected={None:'RETURN_IN_TRANSIT','RETURN_IN_TRANSIT':'RETURN_ARRIVED','RETURN_ARRIVED':'RETURN_RECEIVED'}
        if state['active'] is not None or expected.get(prior.kind if prior else None)!=kind or observed_at < order.created_at:
            raise ValidationError('Resolve delivery stops before recording this authorised return movement')
        if not actor.profile.facilities.filter(pk=order.facility_id,is_deleted=False).exists():
            raise PermissionError('Receiving site is outside your current access')
        if kind=='RETURN_ARRIVED':
            receiving=QueueEntry.objects.filter(pk=receiving_visit_id,organisation=link.organisation,
                facility_id=order.facility_id).first()
            departure=link.events.filter(kind='DEPARTED').first()
            if (not receiving or receiving.pk==visit.pk or receiving.status=='RELEASED'
                    or receiving.reg_number.strip().upper()!=visit.reg_number.strip().upper()
                    or not departure or receiving.entry_timestamp < departure.observed_at or receiving.entry_timestamp > observed_at):
                raise ValidationError('Register and select a new receiving-yard visit for this truck at the authorised return site')
        elif receiving_visit_id:
            raise ValidationError('Receiving visit is recorded only on return arrival')
    else:
        allowed={None:['DOCK_VACATED','DEPARTED'],'DOCK_VACATED':['DEPARTED']}
        if stop_index is not None or kind not in allowed.get(previous.kind if previous else None,[]):
            raise ValidationError('Journey event is out of sequence')
    if previous and observed_at < previous.observed_at:
        raise ValidationError('Journey observation precedes the previous event')
    check_assignment(link)
    separate = visit.milestone_semantics == 'SEPARATE_V1'
    dock = Dock.objects.select_for_update().get(pk=visit.assigned_dock_id) if visit.assigned_dock_id else None
    if origin_event:
        authorized_at = visit.release_authorized_at if separate else visit.exit_timestamp
        if visit.status != 'RELEASED' or not authorized_at or observed_at < authorized_at:
            raise ValidationError('Record an authorised yard release before physical departure')
    if kind == 'DOCK_VACATED':
        if not separate or not dock or dock.current_entry_id != visit.pk:
            raise ValidationError('This visit does not occupy a dock awaiting vacancy observation')
        dock.current_entry = None
        dock.status = 'AVAILABLE'
        dock.save(update_fields=['current_entry','status','updated_at'])
        visit.assigned_dock = dock
        visit.dock_vacated_at = observed_at
        visit.save(update_fields=['dock_vacated_at','updated_at'])
    if kind == 'DEPARTED':
        if separate and dock and dock.current_entry_id == visit.pk:
            raise ValidationError('Record dock vacancy before gate exit')
        if visit.inspection_attempts.exists():
            from regulatory.models import ReleaseRecord
            release = ReleaseRecord.objects.filter(queue_entry=visit,withdrawal__isnull=True).order_by('-created_at','-pk').first()
            if not release or release.attempt.context.trip_id != trip.pk:
                raise ValidationError('Release authority does not match this journey')
            from regulatory.services import release_authority
            release_authority(visit, actor, departure_release=release)
        if separate:
            visit.exit_timestamp = observed_at
            visit.dwell_duration_seconds = max(0,int((observed_at-visit.entry_timestamp).total_seconds()))
            visit.save(update_fields=['exit_timestamp','dwell_duration_seconds','updated_at'])
    event = JourneyEvent.objects.create(organisation=link.organisation,journey=link,creator=actor,
        reason=reason,kind=kind,observed_at=observed_at,details=details,client_key=client_key,
        stop_index=stop_index,return_order=order,receiving_visit_id=receiving_visit_id)
    completed=delivery_state(link)
    target = 'in_transit' if kind == 'DEPARTED' else (
        'delivered' if completed['all_accepted'] else 'returned') if completed['execution_complete'] and kind in ('DELIVERY_ACCEPTED','RETURN_RECEIVED') else None
    if target:
        trip._journey_command = True
        old_status = trip.status
        trip.status = target
        if kind == 'DEPARTED': trip.actual_start = observed_at
        else: trip.actual_end = observed_at
        trip.save(update_fields=['status','actual_start','actual_end','updated_at'])
        TripStatusLog.objects.create(trip=trip,from_status=old_status,to_status=target,updated_by=actor,
            notes=f'Journey event {event.pk}: {kind}')
    from core.models import OutboxEvent
    OutboxEvent.objects.create(organisation=link.organisation,facility=link.facility,
        event_type=kind,payload={'journey_id':link.pk,'trip_id':trip.pk,'queue_entry_id':str(visit.pk),
            'event_id':event.pk,'observed_at':observed_at.isoformat(),'source':'STAFF_ATTESTATION',
            'dwell_seconds':visit.dwell_duration_seconds if kind=='DEPARTED' else None})
    append_audit(facility=link.facility,actor=actor,action='RECORD_JOURNEY_EVENT',
        payload={'journey_id':link.pk,'trip_id':trip.pk,'queue_entry_id':visit.pk,'reg_number':visit.reg_number,'event_id':event.pk,'kind':kind,'reason':reason,
            'previous_state':previous.kind if previous else 'YARD_RELEASE_AUTHORISED','new_state':kind,
            'event_digest':digest({'kind':kind,'observed_at':observed_at.isoformat(),'details':details,'reason':reason,
                'stop_index':stop_index,'return_order_id':return_order_id,'receiving_visit_id':receiving_visit_id})})
    return event
