"""Retained delivery plans and returns; no external acknowledgement or legal clearance inferred."""
from decimal import Decimal, InvalidOperation
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from core.audit import append_audit
from core.models import Facility
from core.rbac import rbac_allows
from trip.permissions import get_user_role
from trip.models import Trip
from yard.models import QueueEntry
from .models import DeliveryPlan, ReturnOrder

DELIVERY_KINDS = ('DESTINATION_ARRIVED','DELIVERY_ACCEPTED','DELIVERY_REJECTED','DELIVERY_REATTEMPT_PLANNED')
RETURN_KINDS = ('RETURN_IN_TRANSIT','RETURN_ARRIVED','RETURN_RECEIVED')


def itinerary(link):
    return [*link.assignment['waypoints'],link.assignment['destination']]


def validate_stops(link, stops):
    labels=itinerary(link)
    if not isinstance(stops,list) or not 1 <= len(stops) <= 30:
        raise ValidationError('Choose one to thirty delivery stops from the recorded itinerary')
    indexes=[]; references=set()
    for stop in stops:
        if not isinstance(stop,dict) or set(stop) != {'route_index','consignments'}:
            raise ValidationError('Each stop requires route_index and consignments')
        index=stop['route_index']
        if type(index) is not int or index < 0 or index >= len(labels) or not isinstance(labels[index],str):
            raise ValidationError('Delivery stop is outside the recorded itinerary')
        indexes.append(index)
        items=stop['consignments']
        if not isinstance(items,list) or not 1 <= len(items) <= 100:
            raise ValidationError('Each stop requires one to one hundred consignments')
        for item in items:
            if not isinstance(item,dict) or set(item) != {'reference','quantity','unit'}:
                raise ValidationError('Consignment requires reference, quantity and unit')
            if any(not isinstance(item[k],str) or not item[k].strip() or len(item[k])>120 for k in ('reference','unit')):
                raise ValidationError('Consignment reference and unit are required')
            if item['reference'] in references:
                raise ValidationError('Each consignment reference must be unique in the plan')
            references.add(item['reference'])
            try: quantity=Decimal(str(item['quantity']))
            except (InvalidOperation,ValueError,TypeError): raise ValidationError('Invalid consignment quantity')
            if not quantity.is_finite() or not 0 < quantity <= Decimal('1000000000') or quantity.as_tuple().exponent < -3:
                raise ValidationError('Consignment quantity must be positive with at most three decimal places')
    if indexes != sorted(set(indexes)) or indexes[-1] != len(labels)-1:
        raise ValidationError('Stops must follow itinerary order and include the final destination')


def current_plan(link):
    return link.delivery_plans.order_by('-version').first()


def delivery_state(link):
    plan=current_plan(link)
    indexes=list(range(len(plan.stops))) if plan else [None]
    rows=[]; active=None
    for index in indexes:
        latest=link.events.filter(kind__in=DELIVERY_KINDS,stop_index=index).order_by('-observed_at','-pk').first()
        returned=link.returns.filter(rejection=latest).first() if latest and latest.kind=='DELIVERY_REJECTED' else None
        resolved=bool(latest and (latest.kind=='DELIVERY_ACCEPTED' or returned))
        if not resolved and active is None: active={'index':index,'latest':latest}
        stop=plan.stops[index] if plan else None
        rows.append({'index':index,'label':itinerary(link)[stop['route_index']] if stop else link.assignment['destination'],
            'consignments':stop['consignments'] if stop else [],'state':latest.kind if latest else 'PENDING',
            'return_order_id':returned.pk if returned else None,'resolved':resolved})
    returns=list(link.returns.order_by('pk'))
    open_returns=[row for row in returns if not row.events.filter(kind='RETURN_RECEIVED').exists()]
    return {'plan':plan,'stops':rows,'active':active,'returns':returns,'open_returns':open_returns,
        'all_accepted':all(row['state']=='DELIVERY_ACCEPTED' for row in rows),
        'execution_complete':active is None and not open_returns}


def lock_link(actor,link):
    from .services import authorize,check_assignment
    link.visit=QueueEntry.objects.select_for_update().get(pk=link.visit_id)
    Facility.objects.select_for_update().get(pk=link.facility_id)
    link.trip=Trip.objects.select_for_update().get(pk=link.trip_id)
    authorize(actor,link.facility)
    check_assignment(link)


@transaction.atomic
def record_plan(actor,link,*,stops,reason,client_key,expected_version):
    lock_link(actor,link)
    old=link.delivery_plans.filter(client_key=client_key).first()
    if old:
        if (old.stops,old.reason,old.creator_id)!=(stops,reason,actor.pk):
            raise ValidationError('Delivery plan replay conflicts with retained data')
        return old
    if link.visit.status=='RELEASED' or link.events.filter(kind='DEPARTED').exists():
        raise ValidationError('Record or revise the delivery plan before release')
    latest=current_plan(link)
    if expected_version != (latest.version if latest else 0):
        raise ValidationError('Delivery plan changed; refresh before revising')
    row=DeliveryPlan.objects.create(organisation=link.organisation,journey=link,creator=actor,
        reason=reason,client_key=client_key,version=expected_version+1,stops=stops)
    append_audit(facility=link.facility,actor=actor,action='RECORD_DELIVERY_PLAN',
        payload={'journey_id':link.pk,'plan_id':row.pk,'version':row.version,'queue_entry_id':link.visit_id})
    return row


@transaction.atomic
def authorise_return(actor,link,*,rejection_id,facility_id,route_reference,route_sha256,route_type,jurisdictions,reason,client_key):
    lock_link(actor,link)
    role=get_user_role(actor)
    if role not in ('OPERATIONS_SUPERVISOR','FACILITY_MANAGER'):
        raise PermissionError('Operations or Facility Manager must authorise returns')
    fields={'rejection_id':rejection_id,'facility_id':facility_id,'route_reference':route_reference,
        'route_sha256':route_sha256,'route_type':route_type,'jurisdictions':jurisdictions,'reason':reason}
    old=link.returns.filter(client_key=client_key).first()
    if old:
        if any(getattr(old,k)!=v for k,v in fields.items()) or old.creator_id!=actor.pk:
            raise ValidationError('Return replay conflicts with retained data')
        return old
    state=delivery_state(link)
    active=state['active']; latest=active['latest'] if active else None
    if not latest or latest.pk!=rejection_id or latest.kind!='DELIVERY_REJECTED':
        raise ValidationError('Authorise return only for the current rejected delivery attempt')
    site=Facility.objects.filter(pk=facility_id,organisation=link.organisation,is_deleted=False).first()
    if not site or not actor.profile.facilities.filter(pk=site.pk).exists():
        raise PermissionError('Return receiving site is outside your tenant/site access')
    row=ReturnOrder.objects.create(organisation=link.organisation,journey=link,creator=actor,
        consignments=state['stops'][active['index'] or 0]['consignments'],client_key=client_key,**fields)
    append_audit(facility=link.facility,actor=actor,action='AUTHORISE_RETURN',payload={'journey_id':link.pk,
        'return_id':row.pk,'rejection_id':rejection_id,'receiving_facility_id':facility_id,'queue_entry_id':link.visit_id})
    return row


@transaction.atomic
def withdraw_release(actor,link,*,reason,client_key):
    from regulatory.models import ReleaseRecord,ReleaseWithdrawal
    from tenancy.releases import require_module
    lock_link(actor,link)
    require_module(link.organisation,'release')
    if get_user_role(actor) not in ('OPERATIONS_SUPERVISOR','FACILITY_MANAGER') or not rbac_allows(get_user_role(actor),'queue','update',link.organisation,link.facility):
        raise PermissionError('Operations or Facility Manager must withdraw release authority')
    old=ReleaseWithdrawal.objects.filter(organisation=link.organisation,client_key=client_key).first()
    if old:
        if old.release.queue_entry_id!=link.visit_id or old.reason!=reason or old.creator_id!=actor.pk:
            raise ValidationError('Withdrawal replay conflicts with another command')
        return old
    visit=link.visit
    if visit.milestone_semantics!='SEPARATE_V1' or visit.exit_timestamp or link.events.filter(kind='DEPARTED').exists():
        raise ValidationError('Withdrawal is permitted only before confirmed physical exit on a separate-milestone visit')
    release=ReleaseRecord.objects.filter(queue_entry=visit,withdrawal__isnull=True).order_by('-created_at','-pk').first()
    if visit.status!='RELEASED' or not release:
        raise ValidationError('No active versioned release authority to withdraw')
    row=ReleaseWithdrawal.objects.create(organisation=link.organisation,creator=actor,release=release,reason=reason,client_key=client_key)
    visit.status='QUARANTINED'; visit.release_authorized_at=None
    visit.save(update_fields=['status','release_authorized_at','updated_at'])
    append_audit(facility=link.facility,actor=actor,action='WITHDRAW_RELEASE',payload={'journey_id':link.pk,
        'queue_entry_id':visit.pk,'release_id':release.pk,'withdrawal_id':row.pk,'reason':reason})
    return row
