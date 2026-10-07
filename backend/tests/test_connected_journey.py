from datetime import timedelta
import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APIClient
from tests.test_regulatory import domain, inspect
from journeys.services import link_visit, record_event
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
