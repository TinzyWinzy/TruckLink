"""Read workspaces and evidence authoring contracts with synthetic records only."""
from datetime import timedelta
from unittest.mock import patch
import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import Facility
from trip.models import Organisation
from journeys.models import JourneyEvent
from journeys.services import link_visit
from regulatory import models as m
from tests.test_regulatory import domain

pytestmark = pytest.mark.django_db

def client(actor):
    c=APIClient(); c.force_authenticate(actor); return c

def test_delivery_board_is_origin_scoped_paginated_and_read_only(domain):
    d=domain; link_visit(d['inspector'],d['entry'],d['trip'],'Synthetic link')
    c=client(d['reviewer']); url=f"/api/deliveries/?facility={d['default_facility'].pk}"
    before=(JourneyEvent.objects.count(),m.InspectionAttempt.objects.count())
    response=c.get(url); assert response.status_code==200
    board=response.data; assert board['total']==1 and board['page_size']==20
    record=board['records'][0]
    assert record['trip']['id']==d['trip'].pk and record['trip']['vehicle']['plate']==d['vehicle'].plate
    assert record['journey']['stage']=='AT_ORIGIN'
    assert record['journey']['integrations']=={'erp':'NOT_CONFIGURED','tracking':'NOT_CONFIGURED'}
    assert c.get(url+'&q=does-not-exist').data['total']==0
    assert c.get(url+'&page=2').data['records']==[]
    assert c.get(url+'&page=bad').status_code==400
    unassigned=Facility.objects.create(organisation=d['org'],name='Other yard',slug='other-delivery-yard')
    assert c.get(f'/api/deliveries/?facility={unassigned.pk}').status_code==404
    with patch('journeys.services.rbac_allows',return_value=False):
        assert c.get(url).status_code==403
    assert c.post(url,{},format='json').status_code==405
    assert (JourneyEvent.objects.count(),m.InspectionAttempt.objects.count())==before

def test_other_tenant_cannot_read_evidence_choices_or_origin_journeys(domain):
    d=domain;link_visit(d['inspector'],d['entry'],d['trip'],'Synthetic origin link')
    other=Organisation.objects.create(name='Isolated synthetic tenant')
    actor=d['ops2'];actor.profile.organisation=other;actor.profile.save()
    c=client(actor)
    response=c.get('/api/regulatory/evidence-workspace/')
    assert response.status_code==200 and response.data['records']==[]
    assert all(not rows for rows in response.data['choices'].values())
    # Even a stale facility membership cannot grant access across organisations.
    assert c.get(f"/api/deliveries/?facility={d['default_facility'].pk}").status_code==403

@pytest.mark.parametrize('entity',['vehicle','driver','trip','load'])
def test_evidence_workspace_and_renewal_preserve_independent_review(domain,entity):
    d=domain;c=client(d['author']);at=timezone.now()
    body={'evidence_key':f'synthetic-{entity}','revision':1,'kind':'SYNTHETIC_DOCUMENT','issuer':'Synthetic issuer','document_ref':'test://retained','document_sha256':'c'*64,'issued_at':(at-timedelta(days=1)).isoformat(),'expires_at':(at+timedelta(days=3)).isoformat(),entity:d[entity].pk}
    created=c.post('/api/regulatory/evidence/',body,format='json');assert created.status_code==201
    pk=created.data['record']['id']
    assert c.post('/api/regulatory/reviews/',{'subject':'evidence','subject_id':pk,'approved':True,'reason':'Self review'},format='json').status_code==409
    data=c.get('/api/regulatory/evidence-workspace/?q='+body['evidence_key']).data
    assert data['can_create'] is True and data['total']==1
    assert data['records'][0]['entity_type']==entity and data['records'][0]['entity_label']
    body['revision']=2
    assert c.post('/api/regulatory/evidence/',body,format='json').status_code==201
    assert m.EvidenceRevision.objects.get(pk=pk).revision==1
    c.force_authenticate(d['reviewer'])
    assert c.post('/api/regulatory/reviews/',{'subject':'evidence','subject_id':pk,'approved':True,'reason':'Independent synthetic review'},format='json').status_code==201
    c.force_authenticate(d['ops'])
    assert c.get('/api/regulatory/evidence-workspace/').data['can_create'] is False
    assert c.post('/api/regulatory/evidence/',{**body,'revision':3},format='json').status_code==403
    with patch('core.rbac.rbac_allows',return_value=False):
        assert c.get('/api/regulatory/evidence-workspace/').status_code==403
