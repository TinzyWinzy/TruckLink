"""Invented fixtures verify operational sequencing, never statutory law."""
import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APIClient
from tests.test_regulatory import domain,inspect
from tests.test_connected_journey import event
from journeys.services import link_visit,record_event
from journeys.execution import record_plan,authorise_return,withdraw_release
from journeys.views import timeline
from regulatory.models import ReleaseRecord
from yard.services import release_entry,ReleaseBlocked
from yard.models import QueueEntry
from core.models import Facility

pytestmark=pytest.mark.django_db
PROOF={'receiver':'Synthetic receiver','evidence_reference':'test://receipt','evidence_sha256':'a'*64}

def prepare(d,multi=False):
    if multi:
        d['trip'].waypoints=['Synthetic intermediate'];d['trip'].save()
    link=link_visit(d['inspector'],d['entry'],d['trip'],'Synthetic link')
    return link

def plan(d,link,multi=False):
    stops=[{'route_index':i,'consignments':[{'reference':f'ORDER-{i}','quantity':'12.500','unit':'cartons'}]} for i in range(2 if multi else 1)]
    return record_plan(d['inspector'],link,stops=stops,reason='Synthetic plan',client_key='plan-1',expected_version=0)

def move(d,link,kind,key,index=None,**extra):
    return record_event(d['ops'],link,kind=kind,client_key=key,observed_at=timezone.now(),
        reason='Synthetic observation',details=PROOF if kind in ('DELIVERY_ACCEPTED','DELIVERY_REJECTED','RETURN_RECEIVED') else {},stop_index=index,**extra)

def depart(d,link):
    inspect(d);release_entry(d['entry'].pk,d['ops']);event(d,link,'DEPARTED','depart')

def test_ordered_stops_do_not_complete_on_intermediate_acceptance(domain):
    d=domain;link=prepare(d,True);row=plan(d,link,True)
    assert record_plan(d['inspector'],link,stops=row.stops,reason=row.reason,client_key=row.client_key,expected_version=0).pk==row.pk
    depart(d,link)
    with pytest.raises(ValidationError):move(d,link,'DESTINATION_ARRIVED','skip',1)
    move(d,link,'DESTINATION_ARRIVED','a0',0);move(d,link,'DELIVERY_ACCEPTED','ok0',0)
    d['trip'].refresh_from_db();assert d['trip'].status=='in_transit' and not d['trip'].actual_end
    assert timeline(link)['active_stop_index']==1
    move(d,link,'DESTINATION_ARRIVED','a1',1);move(d,link,'DELIVERY_ACCEPTED','ok1',1)
    d['trip'].refresh_from_db();assert d['trip'].status=='delivered'
    assert timeline(link)['closure']['physical_delivery']=='ACCEPTED'
    with pytest.raises(ValidationError):record_plan(d['ops'],link,stops=row.stops,reason='late',client_key='late',expected_version=1)

@pytest.mark.parametrize('stops',[
    [],[{'route_index':2,'consignments':[]}],
    [{'route_index':0,'consignments':[{'reference':'A','quantity':'NaN','unit':'kg'}]}],
    [{'route_index':0,'consignments':[{'reference':'A','quantity':'-1','unit':'kg'}]}],
    [{'route_index':0,'consignments':[{'reference':'A','quantity':'0.0001','unit':'kg'}]}],
])
def test_malformed_delivery_plans_are_rejected(domain,stops):
    d=domain;link=prepare(d)
    with pytest.raises(ValidationError):record_plan(d['ops'],link,stops=stops,reason='Bad',client_key='bad',expected_version=0)
    assert not link.delivery_plans.exists()

def test_return_requires_new_receiving_visit_and_receipt_before_completion(domain):
    d=domain;link=prepare(d,True);plan(d,link,True);depart(d,link)
    move(d,link,'DESTINATION_ARRIVED','a0',0);rejection=move(d,link,'DELIVERY_REJECTED','reject',0)
    fields=dict(rejection_id=rejection.pk,facility_id=d['default_facility'].pk,route_reference='test://return-route',route_sha256='b'*64,
        route_type='DOMESTIC',jurisdictions=['TEST'],reason='Synthetic full rejected-stop return',client_key='return-1')
    with pytest.raises(PermissionError):authorise_return(d['inspector'],link,**fields)
    order=authorise_return(d['ops'],link,**fields)
    assert order.consignments[0]['reference']=='ORDER-0'
    assert authorise_return(d['ops'],link,**fields).pk==order.pk
    with pytest.raises(ValidationError):move(d,link,'RETURN_IN_TRANSIT','early-return',return_order_id=order.pk)
    move(d,link,'DESTINATION_ARRIVED','a1',1);move(d,link,'DELIVERY_ACCEPTED','ok1',1)
    d['trip'].refresh_from_db();assert d['trip'].status=='in_transit'
    assert timeline(link)['stage']=='STOPS_COMPLETE_RETURNS_OPEN'
    move(d,link,'RETURN_IN_TRANSIT','return-moving',return_order_id=order.pk)
    with pytest.raises(ValidationError):move(d,link,'RETURN_ARRIVED','old-visit',return_order_id=order.pk,receiving_visit_id=d['entry'].pk)
    receiving=QueueEntry.objects.create(organisation=d['org'],facility=d['default_facility'],reg_number=d['vehicle'].plate,status='WAITING')
    arrival=move(d,link,'RETURN_ARRIVED','return-arrived',return_order_id=order.pk,receiving_visit_id=receiving.pk)
    assert arrival.receiving_visit_id==receiving.pk
    receipt=move(d,link,'RETURN_RECEIVED','return-received',return_order_id=order.pk)
    assert record_event(d['ops'],link,kind=receipt.kind,client_key=receipt.client_key,observed_at=receipt.observed_at,reason=receipt.reason,details=receipt.details,return_order_id=order.pk).pk==receipt.pk
    d['trip'].refresh_from_db();assert d['trip'].status=='returned' and d['trip'].actual_end
    data=timeline(link);assert data['stage']=='COMPLETED_WITH_RETURNS'
    assert data['closure']['commercial']=='NOT_CONFIRMED'
    assert data['closure']['evidence']=='REFERENCE_RECORDED_NOT_RECONCILED'

def test_withdrawal_preserves_authority_history_and_requires_fresh_inspection(domain):
    d=domain;link=prepare(d);inspect(d);release_entry(d['entry'].pk,d['ops'])
    row=withdraw_release(d['ops'],link,reason='Changed instructions',client_key='withdraw-1')
    assert withdraw_release(d['ops'],link,reason=row.reason,client_key=row.client_key).pk==row.pk
    d['entry'].refresh_from_db();assert d['entry'].status=='QUARANTINED' and not d['entry'].exit_timestamp
    with pytest.raises(ReleaseBlocked):release_entry(d['entry'].pk,d['ops'])
    inspect(d,client_key='fresh-inspection');release_entry(d['entry'].pk,d['ops'])
    assert ReleaseRecord.objects.filter(queue_entry=d['entry']).count()==2
    data=timeline(link);assert len([e for e in data['events'] if e['kind']=='YARD_RELEASE_AUTHORISED'])==2
    event(d,link,'DEPARTED','actual-exit')
    with pytest.raises(ValidationError):withdraw_release(d['ops'],link,reason='After exit',client_key='late')

def test_walkthrough_readiness_is_site_scoped_and_read_only(domain):
    d=domain;c=APIClient();c.force_authenticate(d['ops'])
    before=QueueEntry.objects.count()
    response=c.get(f'/api/walkthrough/?facility={d["default_facility"].pk}')
    assert response.status_code==200 and response.data['counts']['vehicles']==1
    assert response.data['visits'][0]['id']==d['entry'].pk
    assert response.data['integrations']['erp']=='NOT_CONFIGURED'
    other=Facility.objects.create(organisation=d['org'],name='Unassigned',slug='unassigned')
    assert c.get(f'/api/walkthrough/?facility={other.pk}').status_code==404
    assert c.post('/api/walkthrough/',{},format='json').status_code==405
    assert QueueEntry.objects.count()==before

def test_journey_command_api_exposes_owned_plan_and_denies_unassigned_site(domain):
    from django.contrib.auth import get_user_model
    from trip.models import UserProfile
    d=domain;link=prepare(d);c=APIClient();c.force_authenticate(d['inspector'])
    body={'stops':[{'route_index':0,'consignments':[{'reference':'A','quantity':'1','unit':'pallet'}]}],
        'reason':'Synthetic API plan','client_key':'api-plan','expected_version':0}
    response=c.post(f'/api/trips/{d["trip"].pk}/journey/plan/',body,format='json')
    assert response.status_code==200 and response.data['journey']['delivery_plan']['version']==1
    assert response.data['journey']['delivery_stops'][0]['label']==d['trip'].destination
    assert any(e['kind']=='DELIVERY_PLAN_RECORDED' for e in response.data['journey']['events'])
    user=get_user_model().objects.create_user(username='unassigned-reviewer')
    UserProfile.objects.create(user=user,organisation=d['org'],role='ADMIN')
    c.force_authenticate(user)
    assert c.post(f'/api/trips/{d["trip"].pk}/journey/plan/',body,format='json').status_code==403
    assert link.delivery_plans.count()==1
