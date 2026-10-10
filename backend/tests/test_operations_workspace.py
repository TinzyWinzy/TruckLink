"""Synthetic multi-role lifecycle and read-workspace contracts. No legal claims."""
from datetime import datetime,timezone as dt_timezone
import pytest
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from django.utils import timezone
from core.audit import append_audit
from core.models import Facility
from trip.models import UserProfile,Organisation
from yard.models import Dock,QueueEntry
from regulatory import services as s,models as m
from journeys.services import link_visit,record_event
from tests.test_regulatory import domain

pytestmark=pytest.mark.django_db

def client(actor):
    c=APIClient();c.force_authenticate(actor);return c

def test_compliance_reads_inspection_but_cannot_mutate_or_release(domain):
    d=domain;c=client(d['reviewer']);entry=d['entry'].pk
    assert c.get(f'/api/regulatory/queue/{entry}/context/').status_code==200
    assert c.get(f'/api/regulatory/queue/{entry}/setup/').data['can_record_context'] is False
    assert c.post(f'/api/regulatory/queue/{entry}/context/',{'configuration':d['config'].pk,'driver':d['driver'].pk,'trip':d['trip'].pk,'load':d['load'].pk,'route_type':'DOMESTIC','jurisdictions':['TEST'],'origin':'Synthetic A','destination':'Synthetic B','evidence_ids':[]},format='json').status_code==403
    assert c.post('/api/regulatory/evaluate/',{'queue_entry':entry,**d['inputs']},format='json').status_code==403
    assert c.post(f'/api/queue/{entry}/release/',{},format='json').status_code==403

def test_worklists_respect_tenant_site_and_do_not_write(domain):
    d=domain;c=client(d['reviewer']);site=d['default_facility'];before=m.InspectionAttempt.objects.count()
    response=c.get(f'/api/operations/?facility={site.pk}')
    assert response.status_code==200
    item=response.data['movements'][0]
    assert item['next_action']['stage']=='TRIP' and item['next_action']['assigned_person'] is None
    assert item['stage_wait_started_at'] is None and item['stage_wait_minutes'] is None
    assert response.data['worklist']['mode']=='latest_visits'
    assert 'setup' not in item and m.InspectionAttempt.objects.count()==before
    unassigned=Facility.objects.create(organisation=d['org'],name='Unassigned',slug='unassigned-read')
    foreign=Organisation.objects.create(name='Other company',slug='other-worklist')
    other=Facility.objects.create(organisation=foreign,name='Foreign site',slug='foreign-read')
    for endpoint in ('operations','pending-approvals'):
        for f in (unassigned,other):assert c.get(f'/api/{endpoint}/?facility={f.pk}').status_code==404
        assert c.post(f'/api/{endpoint}/?facility={site.pk}',{},format='json').status_code==405
    assert c.get(f'/api/operations/?facility={site.pk}&entry=999999').status_code==404
    assert c.get(f'/api/operations/?facility={unassigned.pk}&view=active').status_code==404

def test_active_worklist_is_complete_cursor_paged_and_preserves_legacy_view(domain):
    d=domain;site=d['default_facility'];actor=d['reviewer'];c=client(actor)
    d['entry'].status='COMPLETED';d['entry'].save()
    active=[]
    for index in range(3):
        active.append(QueueEntry.objects.create(
            organisation=d['org'],facility=site,reg_number=f'SYNTH-PAGE-{index}',
            status='QUEUED',entry_timestamp=timezone.now(),
        ))
    QueueEntry.objects.create(
        organisation=d['org'],facility=site,reg_number='SYNTH-LEGACY-RELEASED',
        status='RELEASED',entry_timestamp=timezone.now(),
    )
    path=f'/api/operations/?facility={site.pk}'
    latest=c.get(path)
    assert latest.status_code==200
    assert any(row['id']==d['entry'].pk for row in latest.data['movements'])
    first=c.get(path+'&view=active&limit=2')
    assert first.status_code==200 and first.data['worklist']['total']==3
    assert len(first.data['movements'])==2 and first.data['worklist']['has_more']
    cursor=first.data['worklist']['next_cursor']
    second=c.get(path+f'&view=active&limit=2&cursor={cursor}')
    assert second.status_code==200 and second.data['worklist']['total']==3
    assert len(second.data['movements'])==1 and second.data['worklist']['has_more'] is False
    ids={row['id'] for row in first.data['movements']+second.data['movements']}
    assert ids=={entry.pk for entry in active}
    assert c.get(path+'&view=active&cursor=invalid!').status_code==400
    assert c.get(path+'&view=active&limit=101').status_code==400

def test_pending_evidence_disables_self_review_and_backend_rejects_it(domain):
    d=domain;at=timezone.now();e=m.EvidenceRevision.objects.create(organisation=d['org'],creator=d['author'],evidence_key='new-proof',revision=1,kind='VEHICLE_RATING',issuer='Synthetic issuer',document_ref='test://new-proof',document_sha256='c'*64,issued_at=at,expires_at=d['evidence'].expires_at,vehicle=d['vehicle'])
    path=f'/api/pending-approvals/?facility={d["default_facility"].pk}'
    c=client(d['author']);item=next(x for x in c.get(path).data['evidence_reviews'] if x['id']==e.pk and x['subject']=='evidence')
    assert item['can_review'] is False
    body={'subject':'evidence','subject_id':e.pk,'approved':True,'reason':'Synthetic review'}
    assert c.post('/api/regulatory/reviews/',body,format='json').status_code==409
    c.force_authenticate(d['reviewer']);assert next(x for x in c.get(path).data['evidence_reviews'] if x['id']==e.pk)['can_review'] is True
    assert c.post('/api/regulatory/reviews/',body,format='json').status_code==201
    assert not any(x['id']==e.pk and x['subject']=='evidence' for x in c.get(path).data['evidence_reviews'])

def test_complete_practice_dispatch_with_independent_exception_approval(domain):
    d=domain;c=client(d['author']);site=d['default_facility'];entry=d['entry'];entry.status='QUEUED';entry.save()
    created=c.post('/api/docks/',{'facility':str(site.pk),'name':'SYNTHETIC training dock','capacity_kg':36000},format='json')
    assert created.status_code==201
    c.force_authenticate(d['reviewer']);assert c.post('/api/docks/',{'facility':str(site.pk),'name':'Denied'},format='json').status_code==403
    c.force_authenticate(d['ops']);assert c.post(f'/api/docks/{created.data["dock"]["id"]}/assign/',{'queue_entry':entry.pk},format='json').status_code==200
    entry.refresh_from_db();link=link_visit(d['inspector'],entry,d['trip'],'Synthetic origin link')
    c.force_authenticate(d['inspector']);body={**d['inputs'],'axle_weights':['9000','8000','8000'],'total_weight':'25000','queue_entry':entry.pk}
    result=c.post('/api/regulatory/evaluate/',body,format='json');assert result.status_code==201
    attempt=m.InspectionAttempt.objects.get(pk=result.data['attempt']['id']);assert attempt.decision=='QUARANTINE'
    request=s.request_override(d['ops'],attempt,'Synthetic policy permits independent exception')
    path=f'/api/pending-approvals/?facility={site.pk}';c.force_authenticate(d['ops'])
    assert c.get(path).data['exceptions'][0]['can_review'] is False
    approve=f'/api/regulatory/override-requests/{request.pk}/approve/'
    assert c.post(approve,{'approved':True,'reason':'Self approval denied'},format='json').status_code==409
    c.force_authenticate(d['ops2']);assert c.get(path).data['exceptions'][0]['can_review'] is True
    assert c.post(approve,{'approved':True,'reason':'Independent synthetic approval'},format='json').status_code==201
    from yard.services import release_entry
    release_entry(entry.pk,d['ops2']);entry.refresh_from_db()
    assert entry.release_authorized_at and entry.exit_timestamp is None
    def event(kind,key):return record_event(d['ops2'],link,kind=kind,observed_at=timezone.now(),reason='Synthetic observed event',client_key=key,details={})
    event('DOCK_VACATED','vacancy');departure=event('DEPARTED','exit');entry.refresh_from_db()
    assert entry.exit_timestamp and Dock.objects.get(pk=created.data['dock']['id']).status=='AVAILABLE'
    movement=c.get(f'/api/operations/?facility={site.pk}').data['movements'][0]
    assert movement['next_action']['stage']=='JOURNEY'
    active=c.get(f'/api/operations/?facility={site.pk}&view=active').data['movements']
    active_movement=next(row for row in active if row['id']==entry.pk)
    assert active_movement['stage_wait_started_at']==departure.observed_at
    assert active_movement['stage_wait_basis']=='JOURNEY_EVENT_OBSERVED'
    attempt.refresh_from_db();assert attempt.decision=='QUARANTINE'
    assert m.ReleaseRecord.objects.get(queue_entry=entry).approval.creator_id==d['ops2'].pk

def test_audit_filters_use_site_day_and_export_retained_payload(domain):
    d=domain;site=d['default_facility'];site.timezone='Africa/Harare';site.save()
    row=append_audit(facility=site,action='TEST_MOVE',actor=d['ops'],payload={'reg_number':'SYNTH FILTER','trip_id':d['trip'].pk,'reason':'Synthetic filter','previous_state':'QUEUED','new_state':'AT_DOCK'})
    # A retained UTC observation at 23:30 belongs to the following Harare date.
    from yard.models import AuditLog
    AuditLog.objects.filter(pk=row.pk).update(timestamp=datetime(2026,10,6,23,30,tzinfo=dt_timezone.utc))
    c=client(d['reviewer']);query=f'facility={site.pk}&from=2026-10-07&to=2026-10-07&q=SYNTH%20FILTER'
    response=c.get('/api/audit/?'+query);assert response.status_code==200 and response.data['count']==1
    item=response.data['entries'][0];assert item['timezone']=='Africa/Harare' and item['references']['trip']==d['trip'].pk and item['previous_state']=='QUEUED'
    assert c.get('/api/audit/?'+query.replace('2026-10-07','2026-10-06')).data['count']==0
    export=c.get('/api/audit/export.csv?'+query);assert export.status_code==200 and 'SYNTH FILTER' in export.content.decode()
    assert c.get(f'/api/audit/?facility={site.pk}&from=bad-date').status_code==400
    assert c.get(f'/api/audit/?facility={site.pk}&limit=bad').status_code==400
    legacy=append_audit(facility=site,action='LEGACY_TEST',payload={})
    old=c.get(f'/api/audit/?facility={site.pk}&action=LEGACY_TEST').data['entries'][0]
    assert old['id']==str(legacy.pk) and old['previous_state'] is None and old['references']['vehicle'] is None


def test_named_ownership_is_scoped_optimistic_and_does_not_grant_permissions(domain):
    from yard.models import MovementOwnership
    d=domain;site=d['default_facility'];path=f'/api/operations/{d["entry"].pk}/owner/'
    c=client(d['ops']);choices=c.get(path)
    assert choices.status_code==200 and choices.data['stage']=='TRIP'
    assert {x['id'] for x in choices.data['candidates']}=={d['inspector'].pk,d['ops'].pk,d['ops2'].pk}
    body={'stage':'TRIP','owner_id':d['inspector'].pk,'expected_assignment_id':None,'reason':'Synthetic dispatch handoff'}
    assigned=c.post(path,body,format='json');assert assigned.status_code==201
    item=c.get(f'/api/operations/?facility={site.pk}').data['movements'][0]['next_action']
    assert item['assigned_person']=='inspector' and item['owner_available'] and item['assignment_id']==assigned.data['assignment_id']
    assert c.post(path,body,format='json').status_code==409
    body['expected_assignment_id']=assigned.data['assignment_id'];body['owner_id']=d['reviewer'].pk
    assert c.post(path,body,format='json').status_code==400
    c.force_authenticate(d['reviewer']);assert c.get(path).status_code==403
    c.force_authenticate(d['inspector']);assert c.post(path,body,format='json').status_code==403
    d['inspector'].profile.facilities.clear();c.force_authenticate(d['ops'])
    assert not c.get(f'/api/operations/?facility={site.pk}').data['movements'][0]['next_action']['owner_available']
    assert MovementOwnership.objects.count()==1
    from django.core.exceptions import ValidationError
    with pytest.raises(ValidationError):MovementOwnership.objects.all().update(reason='rewrite')
    d['ops'].profile.facilities.clear();assert c.get(path).status_code==404
