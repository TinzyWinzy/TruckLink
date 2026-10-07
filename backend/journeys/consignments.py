"""Tenant/site scoped customer fulfilment. Quantities come from retained plan lines."""
from decimal import Decimal, ROUND_DOWN
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from django.core.exceptions import ValidationError
from django.db import transaction, IntegrityError
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from core.audit import append_audit
from core.audit_views import find_facility
from core.models import Facility
from .models import Consignment, ConsignmentAllocation, DeliveryPlan
from .services import authorize
from .execution import lock_link, delivery_state, current_plan


class ConsignmentInput(serializers.Serializer):
    reference = serializers.CharField(max_length=120)
    customer_name = serializers.CharField(max_length=200)
    customer_reference = serializers.CharField(max_length=120, required=False, allow_blank=True, default='')
    commodity = serializers.CharField(max_length=200)
    target_quantity = serializers.DecimalField(max_digits=13, decimal_places=3, min_value=Decimal('.001'), max_value=Decimal('1000000000'))
    unit = serializers.CharField(max_length=120)
    deadline = serializers.DateField(required=False, allow_null=True, default=None)
    external_system = serializers.CharField(max_length=80, required=False, allow_blank=True, default='')
    external_reference = serializers.CharField(max_length=120, required=False, allow_blank=True, default='')
    reason = serializers.CharField(max_length=1000)
    client_key = serializers.CharField(max_length=64)


class AllocationInput(serializers.Serializer):
    plan_id = serializers.IntegerField(min_value=1)
    stop_index = serializers.IntegerField(min_value=0)
    reference = serializers.CharField(max_length=120)
    reason = serializers.CharField(max_length=1000)
    client_key = serializers.CharField(max_length=64)


@transaction.atomic
def create_consignment(actor, facility, data):
    Facility.objects.select_for_update().get(pk=facility.pk)
    authorize(actor, facility)
    old = Consignment.objects.filter(organisation=facility.organisation, client_key=data['client_key']).first()
    if old:
        if old.facility_id != facility.pk or old.creator_id != actor.pk or any(getattr(old, key) != value for key, value in data.items()):
            raise ValidationError('Replay key conflicts with a retained consignment')
        return old
    row = Consignment.objects.create(organisation=facility.organisation, facility=facility, creator=actor, **data)
    append_audit(facility=facility, actor=actor, action='CREATE_CONSIGNMENT', payload={
        'consignment_id':row.pk, 'reference':row.reference, 'customer_reference':row.customer_reference,
        'target_quantity':str(row.target_quantity), 'unit':row.unit, 'reason':row.reason})
    return row


@transaction.atomic
def allocate(actor, consignment, data):
    plan = DeliveryPlan.objects.select_related('journey__facility', 'journey__trip', 'journey__visit').filter(
        pk=data['plan_id'], organisation=consignment.organisation, journey__facility=consignment.facility).first()
    if not plan:
        raise ValidationError('Delivery plan not found in this tenant and origin site')
    link = plan.journey
    lock_link(actor, link)
    consignment = Consignment.objects.select_for_update().get(pk=consignment.pk)
    old = consignment.allocations.filter(client_key=data['client_key']).first()
    if old:
        if old.creator_id != actor.pk or any(getattr(old, key) != value for key, value in data.items()):
            raise ValidationError('Replay key conflicts with a retained allocation')
        return old
    if link.visit.status == 'RELEASED' or link.events.filter(kind='DEPARTED').exists():
        raise ValidationError('Allocate the customer load before release and departure')
    if current_plan(link).pk != plan.pk or data['stop_index'] >= len(plan.stops):
        raise ValidationError('Delivery plan changed. Refresh and choose a current line')
    line = next((item for item in plan.stops[data['stop_index']]['consignments'] if item['reference'] == data['reference']), None)
    if not line:
        raise ValidationError('Choose a retained delivery-plan line')
    row = ConsignmentAllocation.objects.create(organisation=consignment.organisation, consignment=consignment,
        creator=actor, plan=plan, quantity=Decimal(str(line['quantity'])), **{key:value for key,value in data.items() if key != 'plan_id'})
    append_audit(facility=consignment.facility, actor=actor, action='ALLOCATE_CONSIGNMENT', payload={
        'consignment_id':consignment.pk, 'consignment_reference':consignment.reference, 'allocation_id':row.pk, 'trip_id':link.trip_id, 'queue_entry_id':link.visit_id,
        'plan_id':plan.pk, 'stop_index':row.stop_index, 'reference':row.reference, 'quantity':str(row.quantity), 'reason':row.reason})
    return row


def serialise(consignment, actor, include_allocations=True):
    from .views import timeline
    from trip.route_views import row as trip_row
    allocated = accepted = returned = Decimal('0')
    allocations = []
    journeys = {}
    for item in consignment.allocations.select_related('plan__journey__trip__vehicle', 'plan__journey__trip__driver',
            'plan__journey__visit__assigned_dock', 'plan__journey__facility').order_by('pk'):
        link = item.plan.journey
        if link.pk not in journeys:
            state = delivery_state(link)
            journeys[link.pk] = (state, timeline(link, actor, include_history=False) if include_allocations else None)
        state, journey = journeys[link.pk]
        stop = state['stops'][item.stop_index]
        allocated += item.quantity
        if stop['state'] == 'DELIVERY_ACCEPTED':
            accepted += item.quantity
        elif stop['return_order_id']:
            returned += item.quantity
        if not include_allocations:
            continue
        allocations.append({'id':item.pk, 'reference':item.reference, 'quantity':str(item.quantity),
            'unit':consignment.unit, 'plan_id':item.plan_id, 'plan_version':item.plan.version,
            'stop_index':item.stop_index, 'stop_label':stop['label'], 'delivery_state':stop['state'],
            'return_order_id':stop['return_order_id'], 'trip':trip_row(link.trip),
            'journey':{key:journey[key] for key in ('stage','next_action','closure','integrations')},
            'created_at':item.created_at, 'creator_id':item.creator_id, 'reason':item.reason})
    percentage = int((accepted * 100 / consignment.target_quantity).quantize(Decimal('1'), rounding=ROUND_DOWN))
    complete = accepted == consignment.target_quantity
    try:
        site_timezone = ZoneInfo(consignment.facility.timezone)
    except ZoneInfoNotFoundError:
        site_timezone = timezone.get_default_timezone()
    overdue = bool(consignment.deadline and consignment.deadline < timezone.localdate(timezone=site_timezone) and not complete)
    def quantity(value):
        return format(value, '.3f')
    return {'id':consignment.pk, 'reference':consignment.reference, 'customer_name':consignment.customer_name,
        'customer_reference':consignment.customer_reference, 'commodity':consignment.commodity,
        'target_quantity':quantity(consignment.target_quantity), 'unit':consignment.unit, 'deadline':consignment.deadline,
        'external_reference':{'system':consignment.external_system, 'reference':consignment.external_reference,
            'verification':'MANUALLY_RECORDED'} if consignment.external_reference else None,
        'created_at':consignment.created_at, 'creator_id':consignment.creator_id, 'reason':consignment.reason,
        'progress':{'allocated':quantity(allocated), 'accepted':quantity(accepted), 'returned':quantity(returned),
            'unallocated':quantity(consignment.target_quantity-allocated), 'outstanding':quantity(consignment.target_quantity-accepted),
            'percentage':percentage, 'complete':complete, 'overdue':overdue},
        'allocations':allocations, 'integration_status':'NOT_CONFIGURED', 'commercial_closure':'NOT_CONFIRMED'}


@api_view(['GET','POST'])
@permission_classes([IsAuthenticated])
def workspace(request, pk=None):
    facility = find_facility(str(request.query_params.get('facility', '')), request.user)
    if not facility:
        return Response({'detail':'Site not found'}, status=404)
    try:
        authorize(request.user, facility, 'read' if request.method == 'GET' else 'create')
        rows = Consignment.objects.filter(organisation=facility.organisation, facility=facility)
        selected = rows.filter(pk=pk).first() if pk else None
        if pk and not selected:
            return Response({'detail':'Consignment not found'}, status=404)
        if request.method == 'POST':
            form = (AllocationInput if pk else ConsignmentInput)(data=request.data)
            form.is_valid(raise_exception=True)
            if pk:
                allocate(request.user, selected, form.validated_data)
            else:
                selected = create_consignment(request.user, facility, form.validated_data)
            return Response({'consignment':serialise(selected, request.user)})
        if pk:
            return Response({'consignment':serialise(selected, request.user)})
        query = request.query_params.get('q', '').strip()[:100]
        rows = rows.filter(Q(reference__icontains=query) | Q(customer_name__icontains=query)
            | Q(customer_reference__icontains=query) | Q(external_reference__icontains=query)).order_by('-pk')
        try:
            page = max(1, int(request.query_params.get('page', '1')))
        except ValueError:
            return Response({'detail':'Page must be an integer'}, status=400)
        try:
            authorize(request.user, facility)
            can_create = True
        except PermissionError:
            can_create = False
        return Response({'records':[serialise(row, request.user, include_allocations=False) for row in rows[(page-1)*20:page*20]],
            'total':rows.count(), 'page':page, 'page_size':20, 'as_of':timezone.now(), 'can_create':can_create,
            'facility':{'id':facility.pk,'name':facility.name}, 'organisation':{'id':facility.organisation_id,'name':facility.organisation.name}})
    except PermissionError as exc:
        return Response({'detail':str(exc)}, status=403)
    except ValidationError as exc:
        return Response({'detail':'; '.join(exc.messages)}, status=409)
    except IntegrityError:
        return Response({'detail':'Reference or line already recorded. Refresh before retrying.'}, status=409)
