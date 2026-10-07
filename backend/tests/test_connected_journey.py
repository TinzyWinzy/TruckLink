from datetime import timedelta
import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APIClient
from tests.test_regulatory import domain, inspect
from journeys.services import link_visit, record_event, assignment
from journeys.models import JourneyLink
from journeys.views import timeline
from yard.services import release_entry, ReleaseBlocked
from trip.models import Trip, Organisation, UserProfile, UserRole
from django.contrib.auth import get_user_model

pytestmark = pytest.mark.django_db


def event(d,link,kind,key,actor=None,details=None):
    return record_event(actor or d['ops'],link,kind=kind,client_key=key,observed_at=timezone.now(),
        details=details or {},reason='Synthetic observed operation')


def test_connected_inspection_release_departure_arrival_and_accepted_delivery(domain):
    d=domain
    link=link_visit(d['inspector'],d['entry'],d['trip'],'Synthetic dispatch link','test-erp','ORDER-1')
    assert link_visit(d['inspector'],d['entry'],d['trip'],'Retry','test-erp','ORDER-1').pk==link.pk
    with pytest.raises(ValidationError): event(d,link,'DEPARTED','early')
    attempt=inspect(d)
    release_entry(d['entry'].pk,d['ops'])
    d['trip'].refresh_from_db()
    assert d['trip'].status=='inquiry'  # Yard release is not physical departure.
    departure=event(d,link,'DEPARTED','departure',d['inspector'])
    with pytest.raises(ValidationError): event(d,link,'DELIVERY_ACCEPTED','no-arrival')
    event(d,link,'DESTINATION_ARRIVED','arrival')
    receipt={'receiver':'Synthetic receiver','evidence_reference':'test://delivery','evidence_sha256':'a'*64}
    event(d,link,'DELIVERY_ACCEPTED','delivery',details=receipt)
    d['trip'].refresh_from_db()
    assert d['trip'].status=='delivered' and d['trip'].actual_end
    link.refresh_from_db()
    data=timeline(link)
    assert data['stage']=='DELIVERY_ACCEPTED'
    assert [e['kind'] for e in data['events']]==['REGISTERED','INSPECTION','YARD_RELEASE_AUTHORISED','DEPARTED','DESTINATION_ARRIVED','DELIVERY_ACCEPTED']
    assert next(e for e in data['events'] if e['kind']=='YARD_RELEASE_AUTHORISED')['attempt_id']==attempt.pk
    assert data['integrations']=={'erp':'NOT_CONFIGURED','tracking':'NOT_CONFIGURED'}
    # Retrying the exact departure retains the original event even after completion.
    assert record_event(d['inspector'],link,kind=departure.kind,observed_at=departure.observed_at,
        details=departure.details,client_key=departure.client_key,reason=departure.reason).pk==departure.pk


def test_rejected_delivery_does_not_complete_trip_and_missing_evidence_is_rejected(domain):
    d=domain; link=link_visit(d['inspector'],d['entry'],d['trip'],'Synthetic')
    inspect(d); release_entry(d['entry'].pk,d['ops']); event(d,link,'DEPARTED','d'); event(d,link,'DESTINATION_ARRIVED','a')
    c=APIClient(); c.force_authenticate(d['ops'])
    body={'kind':'DELIVERY_ACCEPTED','observed_at':timezone.now().isoformat(),'reason':'Synthetic','client_key':'bad','details':{}}
    assert c.post(f'/api/trips/{d["trip"].pk}/journey/events/',body,format='json').status_code==400
    event(d,link,'DELIVERY_REJECTED','reject',details={'receiver':'Test','evidence_reference':'test://reject','evidence_sha256':'b'*64})
    d['trip'].refresh_from_db(); assert d['trip'].status=='in_transit' and d['trip'].actual_end is None


def test_link_rejects_mismatched_assignment_foreign_trip_and_relink(domain):
    d=domain
    wrong=Trip.objects.create(organisation=d['org'],vehicle=d['vehicle'],driver=d['driver'],origin='Other',destination='Other')
    with pytest.raises(ValidationError): link_visit(d['inspector'],d['entry'],wrong,'Wrong context')
    foreign=Trip.objects.create(organisation=Organisation.objects.create(name='Foreign',slug='journey-foreign'),origin='X',destination='Y')
    with pytest.raises(ValidationError): link_visit(d['inspector'],d['entry'],foreign,'Foreign')
    link=link_visit(d['inspector'],d['entry'],d['trip'],'Correct')
    with pytest.raises(ValidationError): link_visit(d['inspector'],d['entry'],wrong,'Relink')
    with pytest.raises(ValidationError): JourneyLink.objects.filter(pk=link.pk).update(reason='Overwrite')
    d['trip'].destination='Altered'
    with pytest.raises(ValidationError): d['trip'].save()


@pytest.mark.parametrize('role',['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','COMPLIANCE_OFFICER','EXECUTIVE','ADMIN'])
def test_all_current_roles_read_same_journey_but_destination_writes_are_restricted(domain,role):
    d=domain; link=link_visit(d['inspector'],d['entry'],d['trip'],'Synthetic')
    actor=get_user_model().objects.create_user(username=f'journey-{role}')
    profile=UserProfile.objects.create(user=actor,organisation=d['org'],role=role)
    profile.facilities.add(d['default_facility'])
    c=APIClient(); c.force_authenticate(actor)
    response=c.get(f'/api/trips/{d["trip"].pk}/journey/')
    assert response.status_code==200 and response.data['journey']['id']==link.pk
    if role not in ('OPERATIONS_SUPERVISOR','FACILITY_MANAGER'):
        with pytest.raises(PermissionError): event(d,link,'DESTINATION_ARRIVED',f'forbidden-{role}',actor)


def test_foreign_site_access_and_legacy_status_bypasses_are_denied(domain):
    d=domain; link=link_visit(d['inspector'],d['entry'],d['trip'],'Synthetic')
    c=APIClient(); c.force_authenticate(d['ops'])
    assert c.post(f'/api/trips/{d["trip"].pk}/status/',{'status':'quoted'},format='json').status_code==409
    assert c.patch(f'/api/trips/{d["trip"].pk}/',{'destination':'Changed'},format='json').status_code==409
    actor=get_user_model().objects.create_user(username='no-yard')
    UserProfile.objects.create(user=actor,organisation=d['org'],role=UserRole.ADMIN)
    c.force_authenticate(actor)
    assert c.get(f'/api/trips/{d["trip"].pk}/journey/').status_code==403


def test_departure_rechecks_authority_after_release(domain, monkeypatch):
    d=domain; link=link_visit(d['inspector'],d['entry'],d['trip'],'Synthetic')
    inspect(d); release_entry(d['entry'].pk,d['ops'])
    future=timezone.now()+timedelta(days=2)
    monkeypatch.setattr('regulatory.services.timezone.now',lambda: future)
    with pytest.raises(ValidationError): event(d,link,'DEPARTED','expired')
    assert not link.events.exists()
    d['trip'].refresh_from_db(); assert d['trip'].status=='inquiry'


def test_release_vacancy_and_exit_are_distinct_and_replay_safe(domain):
    from yard.models import Dock
    from yard.reports import compute_turnaround_stats
    from core.models import OutboxEvent
    d=domain
    dock=Dock.objects.create(organisation=d['org'],facility=d['default_facility'],name='Test dock',
        status='OCCUPIED',current_entry=d['entry'])
    d['entry'].assigned_dock=dock; d['entry'].save()
    link=link_visit(d['inspector'],d['entry'],d['trip'],'Synthetic')
    inspect(d); release_entry(d['entry'].pk,d['ops'])
    d['entry'].refresh_from_db(); dock.refresh_from_db(); link.refresh_from_db()
    assert d['entry'].milestone_semantics=='SEPARATE_V1'
    assert d['entry'].release_authorized_at and d['entry'].exit_timestamp is None
    assert d['entry'].dwell_duration_seconds is None and dock.current_entry_id==d['entry'].pk
    assert timeline(link)['next_action']['kind']=='DOCK_VACATED'
    stats=compute_turnaround_stats([d['entry']],now=timezone.now())
    assert stats['avgTurnaroundMinutes'] is None and stats['avgWaitMinutes'] is not None
    with pytest.raises(ValidationError,match='dock vacancy'): event(d,link,'DEPARTED','skip-vacancy')
    with pytest.raises(PermissionError): event(d,link,'DOCK_VACATED','dispatch-vacancy',d['inspector'])
    vacancy=event(d,link,'DOCK_VACATED','vacancy')
    dock.refresh_from_db(); d['entry'].refresh_from_db()
    assert dock.status=='AVAILABLE' and dock.current_entry is None
    assert d['entry'].dock_vacated_at==vacancy.observed_at and d['entry'].exit_timestamp is None
    assert timeline(link)['next_action']['kind']=='DEPARTED'
    assert timeline(link)['dock_occupied'] is False
    # Reusing the dock must not be disturbed by retries of the old observation.
    from yard.models import QueueEntry
    other=QueueEntry.objects.create(organisation=d['org'],facility=d['default_facility'],reg_number='OTHER')
    dock.current_entry=other; dock.status='OCCUPIED'; dock.save()
    assert record_event(d['ops'],link,kind=vacancy.kind,observed_at=vacancy.observed_at,
        details={},client_key=vacancy.client_key,reason=vacancy.reason).pk==vacancy.pk
    departed=event(d,link,'DEPARTED','exit')
    d['entry'].refresh_from_db(); dock.refresh_from_db()
    assert d['entry'].exit_timestamp==departed.observed_at and dock.current_entry_id==other.pk
    assert d['entry'].dwell_duration_seconds==int((departed.observed_at-d['entry'].entry_timestamp).total_seconds())
    assert OutboxEvent.objects.filter(event_type='RELEASE_AUTHORISED').count()==1
    assert OutboxEvent.objects.filter(event_type='DOCK_VACATED').count()==1
    assert OutboxEvent.objects.filter(event_type='DEPARTED').count()==1


def test_rejected_delivery_reattempt_preserves_history_and_needs_new_receipt(domain):
    d=domain; link=link_visit(d['inspector'],d['entry'],d['trip'],'Synthetic')
    inspect(d); release_entry(d['entry'].pk,d['ops']); event(d,link,'DEPARTED','d'); event(d,link,'DESTINATION_ARRIVED','a')
    rejected={'receiver':'Test receiver','evidence_reference':'test://reject','evidence_sha256':'b'*64}
    event(d,link,'DELIVERY_REJECTED','reject',details=rejected)
    assert timeline(link)['next_action']['kind']=='DELIVERY_REATTEMPT_PLANNED'
    with pytest.raises(ValidationError): event(d,link,'DESTINATION_ARRIVED','skip-plan')
    with pytest.raises(PermissionError): event(d,link,'DELIVERY_REATTEMPT_PLANNED','dispatch-plan',d['inspector'])
    event(d,link,'DELIVERY_REATTEMPT_PLANNED','plan')
    with pytest.raises(ValidationError): event(d,link,'DELIVERY_ACCEPTED','skip-arrival',details=rejected)
    event(d,link,'DESTINATION_ARRIVED','a2')
    with pytest.raises(ValidationError): event(d,link,'DELIVERY_ACCEPTED','no-receipt')
    event(d,link,'DELIVERY_ACCEPTED','accept',details={**rejected,'evidence_reference':'test://accept','evidence_sha256':'c'*64})
    assert link.events.filter(kind='DELIVERY_REJECTED').get().details==rejected
    assert link.events.filter(kind='DESTINATION_ARRIVED').count()==2
    data=timeline(link)
    assert data['closure']['physical_delivery']=='ACCEPTED'
    assert data['closure']['commercial']=='NOT_CONFIRMED' and data['closure']['erp']=='NOT_CONFIGURED'
    with pytest.raises(ValidationError): event(d,link,'DELIVERY_REATTEMPT_PLANNED','after-success')


def test_legacy_link_keeps_combined_history_and_can_depart(domain):
    d=domain
    # Emulate a link retained before separate-milestone semantics were introduced.
    link=JourneyLink.objects.create(organisation=d['org'],facility=d['default_facility'],
        trip=d['trip'],visit=d['entry'],assignment=assignment(d['trip']),
        creator=d['inspector'],reason='Historical synthetic link')
    inspect(d); release_entry(d['entry'].pk,d['ops'])
    d['entry'].refresh_from_db(); old_exit=d['entry'].exit_timestamp
    assert old_exit and d['entry'].milestone_semantics=='LEGACY_COMBINED'
    departure=event(d,link,'DEPARTED','legacy-departure')
    d['entry'].refresh_from_db()
    assert d['entry'].exit_timestamp==old_exit
    assert timeline(link)['physical_exit_at']==departure.observed_at


def test_journey_api_returns_current_handoff_after_each_origin_command(domain):
    from yard.models import Dock
    d=domain
    dock=Dock.objects.create(organisation=d['org'],facility=d['default_facility'],name='API dock',status='OCCUPIED',current_entry=d['entry'])
    d['entry'].assigned_dock=dock; d['entry'].save()
    c=APIClient(); c.force_authenticate(d['ops'])
    url=f'/api/trips/{d["trip"].pk}/journey/'
    response=c.post(url,{'facility':str(d['default_facility'].pk),'visit_id':d['entry'].pk,'reason':'Synthetic API link'},format='json')
    assert response.status_code==200 and response.data['journey']['next_action']['href']==f'/compliance?entry={d["entry"].pk}'
    inspect(d)
    handoff=c.get(url).data['journey']['next_action']
    assert handoff['label']=='Authorise yard release' and handoff['href']=='/queue'
    release_entry(d['entry'].pk,d['ops'])
    for kind,next_kind in [('DOCK_VACATED','DEPARTED'),('DEPARTED','DESTINATION_ARRIVED')]:
        response=c.post(url+'events/',{'kind':kind,'observed_at':timezone.now().isoformat(),
            'reason':'Synthetic observation','client_key':kind,'details':{}},format='json')
        assert response.status_code==200
        data=response.data['journey']
        assert data['next_action']['kind']==next_kind and data['dock_occupied'] is False
        assert bool(data['physical_exit_at'])==(kind=='DEPARTED')
    from yard.serializers import QueueEntrySerializer
    d['entry'].refresh_from_db()
    assert QueueEntrySerializer(d['entry']).data['journey_trip_id']==d['trip'].pk


def test_authorisation_notification_does_not_claim_truck_has_departed():
    from core.notify import message_for
    from core.models import OutboxEvent
    text=message_for(OutboxEvent(event_type='RELEASE_AUTHORISED',payload={'reg_number':'TEST-1'}),'Test yard')
    assert 'Physical gate exit remains unconfirmed' in text and 'left Test yard' not in text
