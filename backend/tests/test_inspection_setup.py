import pytest
from rest_framework.test import APIClient
from tests.test_regulatory import domain
from regulatory import models as m
from trip.models import Organisation,Trip

pytestmark=pytest.mark.django_db

def test_setup_choices_are_matching_tenant_vehicle_and_site(domain):
    d=domain;c=APIClient();c.force_authenticate(d['ops'])
    foreign=Organisation.objects.create(name='Foreign setup',slug='foreign-setup')
    Trip.objects.create(organisation=foreign,origin='Secret',destination='Secret')
    response=c.get(f'/api/regulatory/queue/{d["entry"].pk}/setup/')
    assert response.status_code==200
    data=response.data
    assert data['can_record_context'] and data['can_record_load']
    assert [t['id'] for t in data['trips']]==[d['trip'].pk]
    assert data['configurations'][0]['usable']
    assert not data['blockers']
    assert data['current_context']['trip']==d['trip'].pk
    assert data['current_context']['load']==d['load'].pk
    assert data['current_context']['origin']==d['trip'].origin

def test_setup_preselects_only_the_visit_linked_trip(domain):
    from journeys.models import JourneyLink
    d=domain;c=APIClient();c.force_authenticate(d['ops'])
    JourneyLink.objects.create(organisation=d['org'],facility=d['default_facility'],visit=d['entry'],
        trip=d['trip'],assignment={'synthetic':True},creator=d['inspector'],reason='Synthetic test link')
    response=c.get(f'/api/regulatory/queue/{d["entry"].pk}/setup/')
    assert response.status_code==200
    assert response.data['linked_trip_id']==d['trip'].pk
    assert [trip['id'] for trip in response.data['trips']]==[d['trip'].pk]

def test_operations_records_load_then_context_and_evaluates_separately(domain):
    d=domain;c=APIClient();c.force_authenticate(d['ops'])
    load=c.post('/api/regulatory/loads/',{'reference':'MANIFEST-123','cargo_class':'GENERAL','declared_mass_kg':'1000'},format='json')
    assert load.status_code==201
    body={'configuration':d['config'].pk,'trip':d['trip'].pk,'driver':d['driver'].pk,'load':load.data['record']['id'],
        'route_type':'DOMESTIC','jurisdictions':['TEST'],'origin':d['trip'].origin,'destination':d['trip'].destination,'evidence_ids':[]}
    response=c.post(f'/api/regulatory/queue/{d["entry"].pk}/context/',body,format='json')
    assert response.status_code==201
    assert m.InspectionAttempt.objects.filter(queue_entry=d['entry']).count()==0
    assert c.post('/api/regulatory/evaluate/',{'queue_entry':d['entry'].pk,'context_id':response.data['context']['id'],
        'axle_weights':['1000','1000'],'total_weight':'2000','checklist_results':{},'client_key':'ops-cannot-inspect'},format='json').status_code==403

def test_missing_setup_lists_owned_tasks_and_read_only_role_cannot_record(domain):
    d=domain;c=APIClient();c.force_authenticate(d['ops'])
    d['entry'].reg_number='MISSING-VEHICLE';d['entry'].save()
    response=c.get(f'/api/regulatory/queue/{d["entry"].pk}/setup/')
    assert {x['code'] for x in response.data['blockers']}=={'VEHICLE','TRIP','RATINGS'}
    assert all(x['owner'] for x in response.data['blockers'])
    c.force_authenticate(d['reviewer'])
    assert not c.get(f'/api/regulatory/queue/{d["entry"].pk}/setup/').data['can_record_context']

def test_unreviewed_rating_is_not_selectable_and_foreign_entry_is_hidden(domain):
    d=domain;c=APIClient();c.force_authenticate(d['ops'])
    from regulatory.services import review_record
    review_record(d['reviewer'],d['config'],False,'Synthetic revocation')
    response=c.get(f'/api/regulatory/queue/{d["entry"].pk}/setup/')
    assert not response.data['configurations'][0]['usable']
    assert any(x['code']=='RATINGS' for x in response.data['blockers'])
    d['ops'].profile.facilities.clear()
    assert c.get(f'/api/regulatory/queue/{d["entry"].pk}/setup/').status_code==404
