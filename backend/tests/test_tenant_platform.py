from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone
from core.models import Facility
from core.rbac import rbac_allows
from regulatory.engine.evaluator import digest
from regulatory import models as m, services as s
from tenancy.configuration import defaults, resolved
from tenancy.models import TenantConfiguration
from tenancy.integrations import credential
from trip.models import Organisation, UserProfile, UserRole
from tests.test_auth_tenancy import admin_user, admin_client
from tests.test_regulatory import domain, inspect


def configure(org, content, actor=None):
    version = (TenantConfiguration.objects.filter(organisation=org).order_by('-version').values_list('version',flat=True).first() or 0)+1
    return TenantConfiguration.objects.create(organisation=org,version=version,content=content,digest=digest(content),creator=actor,reason='Synthetic tenant configuration test')


@pytest.mark.django_db
def test_two_tenants_have_independent_branding_roles_policies_and_secrets(default_org, settings):
    other = Organisation.objects.create(name='Other Transport',slug='other-transport')
    first = defaults(); first['branding']['display_name'] = 'First Transport'
    first['permissions']['queue.create'] = []
    first['integrations'] = {'notifications':{'twilio':{'enabled':True,'env_prefix':'TENANT_FIRST'}}}
    configure(default_org,first)
    settings.TENANT_FIRST_ACCOUNT_SID = 'synthetic-not-a-real-secret'
    assert resolved(other)['content']['branding']['display_name'] == 'Other Transport'
    assert rbac_allows('DISPATCH_SUPERVISOR','queue','create',other)
    assert not rbac_allows('DISPATCH_SUPERVISOR','queue','create',default_org)
    assert credential(default_org,'twilio','ACCOUNT_SID') == 'synthetic-not-a-real-secret'
    assert credential(other,'twilio','ACCOUNT_SID') == ''
    assert resolved(other)['version'] == 0


@pytest.mark.django_db
def test_configuration_commands_cannot_target_other_tenant_or_bind_secrets(admin_client, admin_user, default_org, default_facility, settings):
    settings.AUDIT_SALT = 'tenant-config-test'
    other = Organisation.objects.create(name='Other',slug='other-config')
    content = defaults(); content['branding']['display_name'] = 'Custom Tenant'
    response = admin_client.post('/api/tenant/configuration/',{'content':content,'reason':'Change display name','expected_version':0,'organisation':other.pk},format='json')
    assert response.status_code == 201
    assert TenantConfiguration.objects.filter(organisation=other).count() == 0
    row = TenantConfiguration.objects.get(organisation=default_org)
    assert default_facility.audit_logs.filter(action='CONFIGURE_TENANT').exists()
    assert admin_client.post('/api/tenant/configuration/',{'content':content,'reason':'Stale write','expected_version':0},format='json').status_code == 409
    injected = deepcopy(content); injected['integrations'] = {'notifications':{'twilio':{'enabled':True,'env_prefix':'OTHER_TENANT'}}}
    assert admin_client.post('/api/tenant/configuration/',{'content':injected,'reason':'Forbidden secret binding','expected_version':1},format='json').status_code == 403
    with pytest.raises(ValidationError):
        row.save()
    admin_user.profile.role = 'EXECUTIVE'; admin_user.profile.save()
    assert admin_client.post('/api/tenant/configuration/',{'content':content,'reason':'Unauthorized','expected_version':1},format='json').status_code == 403


@pytest.mark.django_db
def test_permission_ceiling_and_admin_lockout_rejected(default_org):
    content = defaults(); content['permissions'] = {'queue.delete':['ADMIN']}
    with pytest.raises(ValidationError):
        configure(default_org,content)
    content = defaults(); content['roles']['ADMIN']['enabled'] = False
    with pytest.raises(ValidationError):
        configure(default_org,content)


def test_policy_revision_invalidates_gate_but_brand_revision_does_not(domain):
    d = domain
    attempt = inspect(d)
    d['entry'].refresh_from_db()
    content = defaults(); content['branding']['display_name'] = 'Renamed Synthetic Tenant'
    configure(d['org'],content,d['author'])
    assert s.release_authority(d['entry'],d['ops'])[0].pk == attempt.pk
    content['workflow']['mandatory_checks'].append('load-seal')
    configure(d['org'],content,d['author'])
    with pytest.raises(ValidationError,match='policy changed'):
        s.release_authority(d['entry'],d['ops'])
    newer = inspect(d,client_key='attempt-2')
    assert newer.decision == 'HOLD'
    assert newer.result['controls'][-1]['missing'] == ['load-seal']
    assert newer.result['tenant_policy']['version'] == 2
    assert attempt.result['tenant_policy']['version'] == 0


def test_internal_policy_stays_private_and_platform_adoption_is_explicit(domain):
    d = domain
    from rest_framework.test import APIClient
    client = APIClient(); client.force_authenticate(d['author'])
    assert client.post('/api/regulatory/platform-catalogue/',{'ruleset_id':d['ruleset'].pk,'reason':'Tenant cannot publish globally'},format='json').status_code == 403
    custodian = get_user_model().objects.create_user(username='platform-custodian',is_superuser=True)
    with pytest.raises(ValidationError,match='internal policy'):
        m.PlatformRuleBundle.objects.create(origin=d['ruleset'],creator=custodian,content=d['ruleset'].content,digest=d['ruleset'].digest,reason='Must not share tenant policy')
    at = timezone.now()
    source = m.SourceRevision.objects.create(organisation=d['org'],creator=d['author'],source_key='shared-fixture',revision=1,
        title='SYNTHETIC catalogue fixture; not verified law',authority='Test',jurisdiction='SHARED',kind='STATUTE',tier='D',provision='TEST',
        document_ref='test://shared',document_sha256='c'*64,published_on=at.date()-timedelta(days=1),effective_from=at.date()-timedelta(days=1),effective_to=at.date()+timedelta(days=10))
    s.review_record(d['reviewer'],source,True,'Synthetic software fixture only')
    unit = m.RuleUnit.objects.create(organisation=d['org'],creator=d['author'],rule_key='shared-gross',revision=1,source=source,definition=d['rule'].definition)
    origin = s.create_ruleset(d['author'],name='Shared fixture',version=1,jurisdiction='SHARED',route_type='DOMESTIC',
                             effective_from=source.effective_from,effective_to=source.effective_to,max_age_seconds=3600,unit_ids=[unit.pk])
    s.publish_ruleset(d['reviewer'],origin,'Synthetic software fixture only')
    client.force_authenticate(custodian)
    publication = client.post('/api/regulatory/platform-catalogue/',{'ruleset_id':origin.pk,'reason':'Synthetic explicit catalogue publication'},format='json')
    assert publication.status_code == 201
    shared = m.PlatformRuleBundle.objects.get(pk=publication.json()['id'])
    other = Organisation.objects.create(name='Second Tenant',slug='second-adopter')
    actor = get_user_model().objects.create_user(username='second-admin')
    UserProfile.objects.create(user=actor,organisation=other,role=UserRole.ADMIN)
    context = SimpleNamespace(organisation=other,jurisdictions=['SHARED'],route_type='DOMESTIC')
    with pytest.raises(ValidationError,match='CONFIGURATION_REQUIRED'):
        s.bundles_for(context,at)
    client.force_authenticate(actor)
    adoption = client.post('/api/regulatory/tenant-selections/',{'jurisdiction':'SHARED','route_type':'DOMESTIC','expected_version':0,'bundle_id':shared.pk,'reason':'Explicit test adoption'},format='json')
    assert adoption.status_code == 201
    selection = m.TenantRuleSelection.objects.get(pk=adoption.json()['id'])
    bundles = s.bundles_for(context,timezone.now())
    assert bundles[0]['platform_bundle_id'] == shared.pk
    assert bundles[0]['tenant_selection_id'] == selection.pk
    assert m.EvidenceRevision.objects.filter(organisation=other).count() == 0
    s.review_record(d['reviewer'],source,False,'Withdraw synthetic source')
    with pytest.raises(ValidationError,match='unverified'):
        s.bundles_for(context,timezone.now())


@pytest.mark.django_db
def test_bak_reference_migration_preserves_entities_and_applies_only_exact_identity(default_org):
    import importlib
    from django.apps import apps
    from trip.models import Vehicle, Trip
    bak = Organisation.objects.create(name='BAK Operations',slug='bak-operations')
    yard = Facility.objects.create(organisation=bak,name='BAK Main Yard',slug='bak-main-yard',timezone='Africa/Harare',yard_config={'mode':'OPERATIONS'})
    vehicle = Vehicle.objects.create(organisation=bak,plate='SYNTHETIC-BAK')
    trip = Trip.objects.create(organisation=bak,facility=yard,vehicle=vehicle,origin='A',destination='B')
    migration = importlib.import_module('tenancy.migrations.0002_bak_reference')
    migration.configure_reference(apps,None)
    migration.configure_reference(apps,None)
    assert resolved(bak)['version'] == 1
    assert resolved(bak)['content']['branding']['display_name'] == 'BAK Logistics'
    assert TenantConfiguration.objects.filter(organisation=default_org).count() == 0
    assert Trip.objects.get(pk=trip.pk).vehicle_id == vehicle.pk
    yard.refresh_from_db()
    assert yard.yard_config == {'mode':'OPERATIONS'} and yard.timezone == 'Africa/Harare'


@pytest.mark.django_db
def test_public_booking_requires_tenant_when_ambiguous_and_preserves_single_tenant(api_client, default_org, mock_geo_router):
    from trip.models import Trip
    body = {'service_type':'household','origin':'Harare, Zimbabwe','destination':'Beitbridge, Zimbabwe'}
    first = api_client.post('/api/public/book/',body,format='json')
    assert first.status_code == 200
    other = Organisation.objects.create(name='Other Booking Tenant',slug='other-booking')
    assert api_client.post('/api/public/book/',body,format='json').status_code == 400
    explicit = api_client.post('/api/public/book/',{**body,'tenant':other.slug},format='json')
    assert explicit.status_code == 200
    assert Trip.objects.get(booking_reference=explicit.json()['booking_reference']).organisation_id == other.pk


@pytest.mark.django_db
def test_whatsapp_sessions_and_signed_webhooks_are_scoped_to_tenant(default_org, settings):
    from unittest.mock import patch
    from rest_framework.test import APIClient
    from whatsapp.handlers import handle_incoming
    from whatsapp.models import WhatsAppSession
    from trip.models import Driver
    other = Organisation.objects.create(name='Other Phone Tenant',slug='other-phone')
    phone = '+263000000000'
    Driver.objects.create(organisation=default_org,name='Synthetic One',phone_number=phone)
    Driver.objects.create(organisation=other,name='Synthetic Two',phone_number=phone)
    assert 'Tenant context' in handle_incoming(phone,'STATUS')
    handle_incoming(phone,'STATUS',organisation=default_org)
    handle_incoming(phone,'STATUS',organisation=other)
    assert WhatsAppSession.objects.filter(phone_number=phone).count() == 2
    config = defaults(); config['integrations'] = {'notifications':{'twilio':{'enabled':True,'env_prefix':'SYNTHETIC_WEBHOOK'}}}
    configure(default_org,config)
    settings.SYNTHETIC_WEBHOOK_AUTH_TOKEN = 'synthetic-token'
    client = APIClient()
    assert client.post('/api/whatsapp/webhook/other-phone/',{'From':phone,'Body':'STATUS'}).status_code == 403
    assert client.post(f'/api/whatsapp/webhook/{default_org.slug}/',{'From':phone,'Body':'STATUS'}).status_code == 403
    with patch('whatsapp.views._validate_twilio_request',return_value=True), patch('whatsapp.views.handle_incoming',return_value='Synthetic reply') as handler:
        response = client.post(f'/api/whatsapp/webhook/{default_org.slug}/',{'From':phone,'Body':'STATUS'})
    assert response.status_code == 200
    assert handler.call_args.kwargs['organisation'].pk == default_org.pk
