"""Synthetic orders only. Exercise real authorisation, retained plans and receiver outcomes."""
from decimal import Decimal
from datetime import timedelta
from datetime import datetime, date, timezone as datetime_timezone
from unittest.mock import patch
import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import Facility
from yard.models import AuditLog, QueueEntry
from trip.models import Organisation, Trip
from journeys.models import Consignment, ConsignmentAllocation
from journeys.consignments import create_consignment, allocate, serialise
from journeys.services import link_visit
from journeys.execution import record_plan, authorise_return
from journeys.views import timeline
from tests.test_regulatory import domain
from tests.test_journey_execution import prepare, plan, move, depart

pytestmark = pytest.mark.django_db


def order(d, **changes):
    data = dict(reference='SYN-ORDER', customer_name='Synthetic customer', customer_reference='SYN-CUSTOMER-ORDER',
        commodity='Synthetic goods', target_quantity=Decimal('25'), unit='cartons', deadline=None,
        external_system='', external_reference='', reason='Synthetic order context', client_key='order-1')
    return create_consignment(d['inspector'], d['default_facility'], {**data, **changes})


def attach(d, customer_order, delivery_plan, index=0, **changes):
    return allocate(d['inspector'], customer_order, {**dict(plan_id=delivery_plan.pk, stop_index=index,
        reference=f'ORDER-{index}', reason='Synthetic allocation', client_key=f'allocation-{index}'), **changes})


def test_order_fulfilment_counts_accepted_quantities_at_each_stop(domain):
    d=domain; link=prepare(d,True); delivery_plan=plan(d,link,True); customer_order=order(d)
    attach(d,customer_order,delivery_plan,0); attach(d,customer_order,delivery_plan,1)
    data=serialise(customer_order,d['ops'])
    assert data['progress']==dict(allocated='25.000',accepted='0.000',returned='0.000',unallocated='0.000',outstanding='25.000',percentage=0,complete=False,overdue=False)
    depart(d,link)
    assert serialise(customer_order,d['ops'])['progress']['percentage']==0
    move(d,link,'DESTINATION_ARRIVED','arrive-0',0)
    assert serialise(customer_order,d['ops'])['progress']['percentage']==0
    move(d,link,'DELIVERY_ACCEPTED','accept-0',0)
    data=serialise(customer_order,d['ops'])
    assert data['progress']['percentage']==50 and data['progress']['outstanding']=='12.500'
    assert data['allocations'][1]['journey']['next_action']['kind']=='DESTINATION_ARRIVED'
    move(d,link,'DESTINATION_ARRIVED','arrive-1',1); move(d,link,'DELIVERY_ACCEPTED','accept-1',1)
    data=serialise(customer_order,d['ops'])
    assert data['progress']['complete'] and data['progress']['percentage']==100
    assert data['commercial_closure']=='NOT_CONFIRMED' and data['integration_status']=='NOT_CONFIGURED'
    assert timeline(link)['customer_consignments'][0]['consignment_id']==customer_order.pk


def test_one_customer_order_groups_multiple_truck_movements(domain):
    d=domain; first=prepare(d); first_plan=plan(d,first); customer_order=order(d); attach(d,customer_order,first_plan)
    trip=Trip.objects.create(organisation=d['org'],vehicle=d['vehicle'],driver=d['driver'],origin='Synthetic C',destination='Synthetic D')
    visit=QueueEntry.objects.create(organisation=d['org'],facility=d['default_facility'],reg_number=d['vehicle'].plate)
    second=link_visit(d['inspector'],visit,trip,'Synthetic second movement')
    second_plan=plan(d,second)
    attach(d,customer_order,second_plan,client_key='second-truck')
    data=serialise(customer_order,d['ops'])
    assert len({item['trip']['id'] for item in data['allocations']})==2
    assert data['progress']['allocated']=='25.000' and data['progress']['accepted']=='0.000'


def test_rejection_and_received_return_never_count_as_customer_fulfilment(domain):
    d=domain; link=prepare(d); delivery_plan=plan(d,link); customer_order=order(d,target_quantity=Decimal('12.5'))
    attach(d,customer_order,delivery_plan); depart(d,link)
    move(d,link,'DESTINATION_ARRIVED','arrive',0); rejection=move(d,link,'DELIVERY_REJECTED','reject',0)
    assert serialise(customer_order,d['ops'])['progress']['percentage']==0
    returned=authorise_return(d['ops'],link,rejection_id=rejection.pk,facility_id=d['default_facility'].pk,
        route_reference='test://return',route_sha256='b'*64,route_type='DOMESTIC',jurisdictions=['TEST'],reason='Synthetic return',client_key='return')
    move(d,link,'RETURN_IN_TRANSIT','return-depart',return_order_id=returned.pk)
    visit=QueueEntry.objects.create(organisation=d['org'],facility=d['default_facility'],reg_number=d['vehicle'].plate)
    move(d,link,'RETURN_ARRIVED','return-arrive',return_order_id=returned.pk,receiving_visit_id=visit.pk)
    move(d,link,'RETURN_RECEIVED','return-receipt',return_order_id=returned.pk)
    data=serialise(customer_order,d['ops'])
    assert data['progress']['percentage']==0 and data['progress']['returned']=='12.500'
    assert data['progress']['outstanding']=='12.500' and data['progress']['unallocated']=='0.000'


def test_replays_are_idempotent_and_conflicting_keys_are_rejected(domain):
    d=domain; customer_order=order(d); assert order(d).pk==customer_order.pk
    with pytest.raises(ValidationError):order(d,customer_name='Different payload')
    link=prepare(d); delivery_plan=plan(d,link); allocation=attach(d,customer_order,delivery_plan)
    assert attach(d,customer_order,delivery_plan).pk==allocation.pk
    with pytest.raises(ValidationError):attach(d,customer_order,delivery_plan,reason='Changed reason')
    assert Consignment.objects.count()==1 and ConsignmentAllocation.objects.count()==1
    assert AuditLog.objects.filter(action='ALLOCATE_CONSIGNMENT').count()==1


@pytest.mark.parametrize('change',[{'unit':'kg'},{'target_quantity':Decimal('1')}])
def test_unit_mismatch_and_overallocation_leave_no_allocation_or_audit(domain,change):
    d=domain; customer_order=order(d,**change); link=prepare(d); delivery_plan=plan(d,link)
    before=AuditLog.objects.count()
    with pytest.raises(ValidationError):attach(d,customer_order,delivery_plan)
    assert not ConsignmentAllocation.objects.exists() and AuditLog.objects.count()==before


def test_duplicate_line_and_plan_replacement_cannot_double_count(domain):
    d=domain; customer_order=order(d); link=prepare(d); delivery_plan=plan(d,link); attach(d,customer_order,delivery_plan)
    other=order(d,reference='OTHER',client_key='other-order')
    with pytest.raises(ValidationError):attach(d,other,delivery_plan)
    with pytest.raises(ValidationError):record_plan(d['inspector'],link,stops=delivery_plan.stops,reason='Replace allocated plan',client_key='v2',expected_version=1)
    assert record_plan(d['inspector'],link,stops=delivery_plan.stops,reason=delivery_plan.reason,client_key=delivery_plan.client_key,expected_version=0).pk==delivery_plan.pk
    with pytest.raises(ValidationError):ConsignmentAllocation.objects.update(quantity=1)
    with pytest.raises(ValidationError):customer_order.delete()


def test_allocations_are_rejected_after_release_but_original_replay_remains_valid(domain):
    d=domain; customer_order=order(d); link=prepare(d,True); delivery_plan=plan(d,link,True)
    allocation=attach(d,customer_order,delivery_plan); depart(d,link)
    assert attach(d,customer_order,delivery_plan).pk==allocation.pk
    with pytest.raises(ValidationError):attach(d,customer_order,delivery_plan,1)


def test_api_is_scoped_read_only_and_searches_customer_context(domain):
    d=domain; customer_order=order(d); link=prepare(d); attach(d,customer_order,plan(d,link))
    client=APIClient();client.force_authenticate(d['reviewer'])
    url=f'/api/consignments/?facility={d["default_facility"].pk}'
    before=(AuditLog.objects.count(),ConsignmentAllocation.objects.count())
    data=client.get(url+'&q=Synthetic customer').data
    assert data['total']==1 and not data['can_create']
    assert client.get(f'/api/consignments/{customer_order.pk}/?facility={d["default_facility"].pk}').status_code==200
    assert client.post(url,{},format='json').status_code==403
    assert client.get(f'/api/deliveries/?facility={d["default_facility"].pk}&q=Synthetic customer').data['total']==1
    assert before==(AuditLog.objects.count(),ConsignmentAllocation.objects.count())
    assert client.get(url+'&page=invalid').status_code==400


def test_tenant_and_site_isolation_in_reads_and_allocation(domain):
    d=domain; customer_order=order(d); link=prepare(d); delivery_plan=plan(d,link)
    site=Facility.objects.create(organisation=d['org'],name='Other site',slug='other-site')
    d['inspector'].profile.facilities.add(site)
    other=create_consignment(d['inspector'],site,dict(reference='SITE-ORDER',customer_name='Synthetic',commodity='Goods',
        target_quantity=Decimal('25'),unit='cartons',reason='Test site',client_key='site-order'))
    with pytest.raises(ValidationError):attach(d,other,delivery_plan)
    foreign=Organisation.objects.create(slug='synthetic-foreign',name='Synthetic foreign tenant')
    client=APIClient();client.force_authenticate(d['inspector'])
    assert client.get(f'/api/consignments/{customer_order.pk}/?facility={site.pk}').status_code==404
    d['inspector'].profile.organisation=foreign;d['inspector'].profile.save()
    assert client.get(f'/api/consignments/?facility={d["default_facility"].pk}').status_code in (403,404)
    assert client.get(f'/api/consignments/{customer_order.pk}/?facility={d["default_facility"].pk}').status_code in (403,404)


def test_overdue_and_module_permission_denials(domain):
    d=domain; customer_order=order(d,deadline=timezone.localdate()-timedelta(days=1))
    assert serialise(customer_order,d['ops'])['progress']['overdue']
    with patch('journeys.services.rbac_allows',return_value=False):
        with pytest.raises(PermissionError):order(d,reference='denied',client_key='denied')
    with patch('tenancy.releases.module_enabled',return_value=False):
        with pytest.raises(PermissionError):order(d,reference='disabled',client_key='disabled')
    assert Consignment.objects.count()==1


def test_deadline_uses_the_origin_site_timezone(domain):
    d=domain;d['default_facility'].timezone='America/Los_Angeles';d['default_facility'].save()
    customer_order=order(d,deadline=date(2026,10,7))
    with patch('journeys.consignments.timezone.now',return_value=datetime(2026,10,8,1,tzinfo=datetime_timezone.utc)):
        assert not serialise(customer_order,d['ops'])['progress']['overdue']


def test_api_creates_and_allocates_exact_plan_quantities_with_audit_references(domain):
    from core.audit_views import audit_entry
    d=domain;link=prepare(d);delivery_plan=plan(d,link)
    client=APIClient();client.force_authenticate(d['inspector'])
    base=f'/api/consignments/?facility={d["default_facility"].pk}'
    body=dict(reference='API-ORDER',customer_name='Synthetic API customer',commodity='Goods',target_quantity='25',
        unit='cartons',external_system='Test ERP',external_reference='SYN-ERP-1',reason='Synthetic API order',client_key='api-order')
    response=client.post(base,body,format='json');assert response.status_code==200
    customer_id=response.data['consignment']['id']
    endpoint=f'/api/consignments/{customer_id}/?facility={d["default_facility"].pk}'
    response=client.post(endpoint,dict(plan_id=delivery_plan.pk,stop_index=0,reference='ORDER-0',
        reason='Synthetic API allocation',client_key='api-allocate',quantity='999'),format='json')
    assert response.status_code==200
    assert response.data['consignment']['progress']['allocated']=='12.500'
    entry=audit_entry(AuditLog.objects.get(action='ALLOCATE_CONSIGNMENT'),d['default_facility'])
    assert entry['references']['consignment']==customer_id and entry['references']['order_reference']=='API-ORDER'
    assert client.get(base).data['records'][0]['allocations']==[]
    assert len(client.get(endpoint).data['consignment']['allocations'])==1


def test_missing_audit_configuration_rolls_back_order_creation(domain,settings):
    from core.audit import AuditSaltMissing
    d=domain;settings.AUDIT_SALT=''
    with pytest.raises(AuditSaltMissing):order(d)
    assert not Consignment.objects.exists()


@pytest.mark.parametrize('body',[{'target_quantity':'NaN'},{'target_quantity':'0'},{'target_quantity':'1.0001'},{'unit':''}])
def test_api_rejects_invalid_quantities_and_units(domain,body):
    d=domain;client=APIClient();client.force_authenticate(d['inspector'])
    payload=dict(reference='invalid',customer_name='Synthetic',commodity='Goods',target_quantity='10',unit='kg',reason='Test',client_key='invalid')
    response=client.post(f'/api/consignments/?facility={d["default_facility"].pk}',{**payload,**body},format='json')
    assert response.status_code==400 and not Consignment.objects.exists()
