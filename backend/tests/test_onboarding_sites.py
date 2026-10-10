import pytest
from core.models import Facility
from trip.models import Organisation
from tests.test_auth_tenancy import admin_client, admin_user


@pytest.mark.django_db
def test_site_creation_is_scoped_audited_and_does_not_activate(admin_client, admin_user, default_org, settings):
    settings.AUDIT_SALT = 'onboarding-test'
    other = Organisation.objects.create(name='Other', slug='other-onboarding')
    response = admin_client.post('/api/tenant/sites/', {'name':'Main yard','timezone':'Africa/Harare','organisation':other.pk}, format='json')
    assert response.status_code == 201
    site = Facility.objects.get(pk=response.json()['site']['id'])
    assert site.organisation_id == default_org.pk
    assert site in admin_user.profile.facilities.all()
    assert site.yard_config == {'mode':'OPERATIONS'}
    assert site.audit_logs.filter(action='CREATE_SITE').exists()
    from tenancy.models import ReleaseActivation
    assert not ReleaseActivation.objects.filter(organisation=default_org).exists()
    assert not Facility.objects.filter(organisation=other).exists()
    listed = admin_client.get('/api/tenant/sites/').json()['sites']
    assert any(s['id']==site.pk and not s['placeholder'] for s in listed)


@pytest.mark.django_db
def test_site_validation_and_admin_boundary(admin_client, admin_user, default_org):
    before = Facility.objects.filter(organisation=default_org).count()
    assert admin_client.post('/api/tenant/sites/', {'name':'Main','timezone':'invalid/timezone'}, format='json').status_code == 400
    assert Facility.objects.filter(organisation=default_org).count() == before
    admin_user.profile.role = 'EXECUTIVE'
    admin_user.profile.save()
    assert admin_client.post('/api/tenant/sites/', {'name':'Main','timezone':'UTC'}, format='json').status_code == 403
