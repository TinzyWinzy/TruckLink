from unittest.mock import patch
from datetime import timedelta
import pytest
from django.utils import timezone
from trip.models import Trip, TripPosition, Vehicle, Organisation
from core.models import Facility
from tests.test_auth_tenancy import admin_user, admin_client

DATA = {'origin':'Harare','destination':'Johannesburg','waypoints':['Beitbridge'],
        'route_type':'CROSS_BORDER','jurisdictions':['ZW','ZA'],'client_key':'route-001'}


@pytest.fixture
def routing_provider():
    points = {'Harare':{'lon':31,'lat':-18},'Beitbridge':{'lon':30,'lat':-22},'Johannesburg':{'lon':28,'lat':-26}}
    def routed(coords):
        return {'geometry':{'type':'LineString','coordinates':[list(c) for c in coords]},
                'distance_meters':1000000,'duration_seconds':40000,'distance_mi':621.37}
    with patch('trip.route_views.geocoding.geocode',side_effect=lambda label: points.get(label)), patch('trip.route_views.routing.route',side_effect=routed) as router:
        yield router


@pytest.mark.django_db
def test_preview_orders_waypoints_and_does_not_create_trip(admin_client, default_facility, routing_provider):
    count = Trip.objects.count()
    response = admin_client.post('/api/routes/preview/',{**DATA,'facility':default_facility.id},format='json')
    assert response.status_code == 200
    routing_provider.assert_called_once_with([(31,-18),(30,-22),(28,-26)])
    assert Trip.objects.count() == count
    result = response.json()['routing']
    assert result['regulatory_clearance'] == 'NOT_EVALUATED'
    assert result['heavy_vehicle_suitability'] == 'UNVERIFIED'
    assert result['jurisdictions'] == ['ZW','ZA']


@pytest.mark.django_db
def test_save_is_scoped_audited_and_replay_safe(admin_client, default_facility, routing_provider, settings):
    settings.AUDIT_SALT = 'route-test-only'
    payload = {**DATA,'facility':default_facility.id}
    saved = admin_client.post('/api/routes/drafts/',payload,format='json')
    assert saved.status_code == 201
    trip = Trip.objects.get(pk=saved.json()['trip']['id'])
    assert trip.organisation_id == default_facility.organisation_id and trip.facility_id == default_facility.id
    assert trip.status == 'inquiry' and trip.hos_daily_logs is None
    assert default_facility.audit_logs.filter(action='SAVE_ROUTE_DRAFT').count() == 1
    again = admin_client.post('/api/routes/drafts/',payload,format='json')
    assert again.status_code == 200 and again.json()['replayed'] is True
    assert Trip.objects.filter(facility=default_facility).count() == 1
    assert admin_client.post('/api/routes/drafts/',{**payload,'origin':'Changed'},format='json').status_code == 409


@pytest.mark.django_db
def test_workspace_scopes_yard_and_reports_stale_positions(admin_client, default_facility):
    other = Facility.objects.create(organisation=default_facility.organisation,name='Other yard',slug='other-yard')
    hidden = Trip.objects.create(organisation=default_facility.organisation,facility=other,origin='Hidden',destination='Hidden')
    Trip.objects.create(organisation=Organisation.objects.create(name='Foreign',slug='foreign-routes'),origin='Foreign',destination='Foreign')
    trip = Trip.objects.create(organisation=default_facility.organisation,facility=default_facility,origin='A',destination='B')
    pos = TripPosition.objects.create(trip=trip,lat=-18,lon=31,source='manual')
    TripPosition.objects.filter(pk=pos.pk).update(timestamp=timezone.now()-timedelta(minutes=20))
    response = admin_client.get(f'/api/routes/workspace/?facility={default_facility.id}')
    assert response.status_code == 200
    assert [t['id'] for t in response.json()['trips']] == [trip.id]
    assert response.json()['trips'][0]['position']['stale'] is True
    assert response.json()['trips'][0]['position']['source'] == 'manual'
    assert admin_client.get(f'/api/routes/workspace/?facility={other.id}').status_code == 404
    assert admin_client.get(f'/api/trips/{hidden.pk}/positions/').status_code == 403
    assert hidden.pk not in [t['id'] for t in admin_client.get('/api/trips/').json()['trips']]


@pytest.mark.django_db
def test_foreign_assignment_and_bad_jurisdictions_fail_before_routing(admin_client, default_facility, routing_provider):
    foreign = Organisation.objects.create(name='Foreign',slug='foreign-assignment')
    vehicle = Vehicle.objects.create(organisation=foreign,plate='FOREIGN')
    payload = {**DATA,'facility':default_facility.id}
    assert admin_client.post('/api/routes/preview/',{**payload,'vehicle_id':vehicle.id},format='json').status_code == 404
    assert admin_client.post('/api/routes/preview/',{**payload,'jurisdictions':['ZW']},format='json').status_code == 400
    assert admin_client.post('/api/routes/preview/',{**payload,'waypoints':['A']*9},format='json').status_code == 400
    routing_provider.assert_not_called()


@pytest.mark.django_db
def test_provider_failure_does_not_save_and_readonly_role_cannot_save(admin_client, default_facility, routing_provider, admin_user):
    payload = {**DATA,'facility':default_facility.id}
    with patch('trip.route_views.routing.route',return_value=None):
        assert admin_client.post('/api/routes/drafts/',payload,format='json').status_code == 502
    assert Trip.objects.count() == 0
    admin_user.profile.role = 'EXECUTIVE'; admin_user.profile.save()
    assert admin_client.post('/api/routes/drafts/',payload,format='json').status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize('geometry', [None, {'type':'LineString','coordinates':None}, {'type':'LineString','coordinates':[[181,0],[31,-18]]}])
def test_malformed_provider_response_cannot_save(admin_client, default_facility, routing_provider, geometry):
    with patch('trip.route_views.routing.route',return_value={'geometry':geometry,'distance_meters':1,'duration_seconds':1}):
        result = admin_client.post('/api/routes/drafts/',{**DATA,'facility':default_facility.id},format='json')
    assert result.status_code == 502
    assert Trip.objects.count() == 0


@pytest.mark.django_db
def test_legacy_estimate_preserves_waypoint_order(admin_client, routing_provider):
    response = admin_client.post('/api/trip/estimate/',{'origin':'Harare','destination':'Johannesburg','waypoints':['Beitbridge']},format='json')
    assert response.status_code == 200
    routing_provider.assert_called_once_with([(31,-18),(30,-22),(28,-26)])
