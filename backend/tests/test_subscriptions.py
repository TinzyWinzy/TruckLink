"""Disposable tenants and grants; no commercial contract or production data."""
from datetime import timedelta
from importlib import import_module
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import connection
from django.utils import timezone
from rest_framework.test import APIClient

from core.audit import verify_chain
from core.models import Facility
from tenancy.catalogue import expand_modules
from tenancy.configuration import resolved
from tenancy.models import TenantEntitlementVersion, TenantModuleSelection, ReleaseActivation, ArtifactReview
from tenancy.registry import MODULES
from tenancy.releases import activate, module_enabled
from tenancy.subscriptions import entitlement, issue_entitlement
from trip.models import Organisation, UserProfile
from tests.test_auth_tenancy import admin_user, admin_client
from tests.test_architecture_amendment import release

pytestmark = pytest.mark.django_db


@pytest.fixture
def operator():
    return get_user_model().objects.create_superuser(username='synthetic-platform-operator',password='test-only')


def test_dependencies_keep_safety_and_audit_included():
    assert expand_modules(['docks']) == ['audit','docks','inspection','release','yard']
    assert expand_modules(['routing','modelling']) == ['audit','fleet','modelling','reports','routing']
    assert expand_modules([]) == ['audit']
    for invalid in (['yard','yard'],['tracker'],{},[True]):
        with pytest.raises(ValidationError):
            expand_modules(invalid)


def test_admin_request_is_versioned_scoped_and_does_not_grant_or_activate(admin_client,admin_user,default_org,default_facility):
    default_org.requires_release = True; default_org.save()
    response = admin_client.post('/api/tenant/subscription/',{'modules':['yard'],'expected_version':0,'reason':'Synthetic selection'},format='json')
    assert response.status_code == 201, response.data
    assert response.data['selection']['required_modules'] == ['audit','inspection','release','yard']
    assert response.data['entitlement']['modules'] == ['audit']
    assert not response.data['effective_modules']['yard']
    assert not TenantEntitlementVersion.objects.exists() and not ReleaseActivation.objects.exists()
    assert response['Cache-Control'] == 'private, no-store'
    assert admin_client.post('/api/tenant/subscription/',{'modules':[],'expected_version':0,'reason':'Stale'},format='json').status_code == 409
    assert admin_client.post('/api/tenant/subscription/',{'modules':[],'expected_version':1,'reason':'Audit only'},format='json').status_code == 201
    assert TenantModuleSelection.objects.order_by('-version').first().modules == ['audit']
    for extra in ({'organisation':999},{'entitlement':{'modules':['yard']}}):
        assert admin_client.post('/api/tenant/subscription/',{'modules':['yard'],'expected_version':2,'reason':'Rejected',**extra},format='json').status_code == 400
    assert verify_chain(default_facility)['ok']
    with pytest.raises(ValidationError):
        TenantModuleSelection.objects.first().delete()
    foreign = Organisation.objects.create(name='Other',slug='other-subscription')
    assert not TenantModuleSelection.objects.filter(organisation=foreign).exists()
    admin_user.profile.role = 'EXECUTIVE'; admin_user.profile.save()
    assert admin_client.get('/api/tenant/subscription/').status_code == 403


def test_operator_grant_is_immutable_and_does_not_activate_unreleased_tenant(operator,admin_user,default_org,default_facility):
    default_org.requires_release = True; default_org.save()
    with pytest.raises(PermissionError):
        issue_entitlement(admin_user,default_org,['yard'],0,'Unauthorized')
    row = issue_entitlement(operator,default_org,['yard'],0,'Synthetic approved trial',basis='TRIAL')
    assert row.modules == ['audit','inspection','release','yard']
    assert not module_enabled(default_org,'yard') and not ReleaseActivation.objects.exists()
    assert resolved(default_org)['subscription']['basis'] == 'TRIAL'
    with pytest.raises(ValidationError):
        issue_entitlement(operator,default_org,['reports'],0,'Stale')
    with pytest.raises(ValidationError):
        row.save()
    with pytest.raises(ValidationError):
        TenantEntitlementVersion.objects.filter(pk=row.pk).update(state='SUSPENDED')
    with pytest.raises(ValidationError):
        row.delete()
    assert verify_chain(default_facility)['ok']


def test_effective_dates_and_suspension_never_resurrect_older_grants(operator,default_org,default_facility):
    now = timezone.now()
    issue_entitlement(operator,default_org,['reports'],0,'Synthetic trial',basis='TRIAL',effective_from=now-timedelta(days=2))
    issue_entitlement(operator,default_org,['routing'],1,'Future revision',effective_from=now+timedelta(days=1))
    assert entitlement(default_org,now)['modules'] == ['audit','reports']
    assert entitlement(default_org,now+timedelta(days=2))['modules'] == ['audit','fleet','routing']
    issue_entitlement(operator,default_org,['reports'],2,'Time bounded revision',effective_from=now-timedelta(hours=1),effective_to=now+timedelta(hours=1))
    assert entitlement(default_org,now+timedelta(hours=1))['state'] == 'EXPIRED'
    assert entitlement(default_org,now+timedelta(days=2))['modules'] == ['audit']
    issue_entitlement(operator,default_org,['reports'],3,'Synthetic suspension',state='SUSPENDED')
    assert not module_enabled(default_org,'reports')
    assert module_enabled(default_org,'audit')
    with pytest.raises(ValidationError):
        issue_entitlement(operator,default_org,[],4,'Invalid dates',effective_from=now,effective_to=now)


def test_release_needs_entitlement_and_current_independent_review(operator,admin_user,default_org):
    reviewer = get_user_model().objects.create_user(username='synthetic-independent-reviewer')
    UserProfile.objects.create(user=reviewer,organisation=default_org,role='COMPLIANCE_OFFICER')
    default_org.requires_release=True; default_org.save()
    modules = {key:key in expand_modules(['yard']) for key in MODULES}
    with pytest.raises(ValidationError,match='entitlement'):
        release(default_org,admin_user,reviewer,modules)
    # Build a retained release under the compatibility ceiling, then test activation independently.
    default_org.requires_release=False; default_org.save()
    from tenancy.models import TenantConfiguration, TenantArtifactRevision
    # Failed model creation left draft rows; use a separate disposable tenant for activation.
    org = Organisation.objects.create(name='Synthetic activated tenant',slug='subscription-activation')
    admin_user.profile.organisation=org; admin_user.profile.save()
    reviewer.profile.organisation=org; reviewer.profile.save()
    row = release(org,admin_user,reviewer,modules)
    org.requires_release=True; org.save()
    with pytest.raises(ValidationError,match='entitlement'):
        activate(admin_user,row,0,'No grant')
    issue_entitlement(operator,org,['yard'],0,'Synthetic trial',basis='TRIAL')
    workflow = TenantArtifactRevision.objects.get(organisation=org,kind='WORKFLOW')
    ArtifactReview.objects.create(organisation=org,creator=reviewer,artifact=workflow,approved=False,reason='Revoke synthetic review')
    with pytest.raises(ValidationError,match='independent'):
        activate(admin_user,row,0,'Revoked review')
    ArtifactReview.objects.create(organisation=org,creator=reviewer,artifact=workflow,approved=True,reason='Independent synthetic approval')
    activate(admin_user,row,0,'Approved configuration')
    assert module_enabled(org,'yard')
    assert not module_enabled(org,'reports')
    assert TenantConfiguration.objects.filter(organisation=org).exists()


def test_revoked_module_blocks_writes_retains_history_and_scopes_dashboard(operator,admin_client,default_org,default_facility):
    assert module_enabled(default_org,'routing')  # explicit legacy compatibility
    issue_entitlement(operator,default_org,['reports'],0,'Synthetic reports only')
    assert admin_client.post('/api/routes/drafts/',{'facility':default_facility.pk},format='json').status_code == 403
    assert admin_client.get('/api/routes/workspace/',{'facility':default_facility.pk}).status_code == 200
    response = admin_client.get('/api/reports/dashboard/',{'facility':default_facility.pk})
    assert response.status_code == 200, response.data
    issue_entitlement(operator,default_org,[],1,'Synthetic restriction')
    assert admin_client.get('/api/reports/dashboard/',{'facility':default_facility.pk}).status_code == 403
    foreign = Organisation.objects.create(name='Other dashboard',slug='other-dashboard')
    site = Facility.objects.create(organisation=foreign,name='Foreign',slug='foreign')
    assert admin_client.get('/api/reports/dashboard/',{'facility':site.pk}).status_code == 404
    assert admin_client.get('/api/audit/',{'facility':default_facility.pk}).status_code == 200


def test_fleet_access_cannot_bypass_dispatch_entitlement_via_legacy_calculator(operator,admin_client,default_org):
    issue_entitlement(operator,default_org,['fleet'],0,'Synthetic fleet only')
    for path in ('/api/trip/','/api/trip/estimate/','/api/routes/preview/'):
        assert admin_client.post(path,{},format='json').status_code == 403


def test_workspace_intersects_modules_roles_and_assigned_sites(operator,admin_client,admin_user,default_org,default_facility):
    response = admin_client.get('/api/tenant/workspace/',{'facility':default_facility.pk})
    assert response.status_code == 200
    assert 'dock_setup' in {r['key'] for r in response.data['cards']}
    assert 'docks' not in {r['key'] for r in response.data['cards']}
    issue_entitlement(operator,default_org,['routing'],0,'Synthetic routing only')
    response = admin_client.get('/api/tenant/workspace/',{'facility':default_facility.pk})
    assert {r['key'] for r in response.data['cards']} == {'fleet','deliveries','consignments','audit'}
    admin_user.profile.role='EXECUTIVE'; admin_user.profile.save()
    response = admin_client.get('/api/tenant/workspace/',{'facility':default_facility.pk})
    assert {r['key'] for r in response.data['cards']} == {'deliveries','consignments','audit'}
    from tenancy.configuration import defaults
    from tenancy.models import TenantConfiguration
    from regulatory.engine.evaluator import digest
    content = defaults(); content['permissions']['routes.read'] = []
    TenantConfiguration.objects.create(organisation=default_org,version=1,creator=admin_user,content=content,digest=digest(content),reason='Synthetic permission narrowing')
    response = admin_client.get('/api/tenant/workspace/',{'facility':default_facility.pk})
    assert {r['key'] for r in response.data['cards']} == {'audit'}
    unassigned = Facility.objects.create(organisation=default_org,name='Unassigned',slug='unassigned')
    assert admin_client.get('/api/tenant/workspace/',{'facility':unassigned.pk}).status_code == 404
    foreign = Organisation.objects.create(name='Foreign workspace',slug='foreign-workspace')
    foreign_site = Facility.objects.create(organisation=foreign,name='Foreign',slug='foreign')
    assert admin_client.get('/api/tenant/workspace/',{'facility':foreign_site.pk}).status_code == 404


def test_failed_audit_rolls_back_grant(operator,default_org,default_facility):
    with patch('core.audit.append_audit',side_effect=RuntimeError('Synthetic failure')):
        with pytest.raises(RuntimeError):
            issue_entitlement(operator,default_org,['reports'],0,'Atomic test')
    assert not TenantEntitlementVersion.objects.filter(organisation=default_org).exists()


def test_backfill_preserves_established_access_and_onboarding_lock(default_org):
    new = Organisation.objects.create(name='Unreleased synthetic tenant',slug='unreleased-subscription',requires_release=True)
    migration = import_module('tenancy.migrations.0006_preserve_existing_entitlements')
    editor = SimpleNamespace(connection=connection)
    migration.preserve_existing(apps,editor); migration.preserve_existing(apps,editor)
    assert TenantEntitlementVersion.objects.filter(organisation=default_org).count() == 1
    assert entitlement(default_org)['modules'] == sorted(MODULES)
    assert entitlement(new)['modules'] == ['audit']
    assert not module_enabled(new,'yard')


def test_backfill_preserves_an_activated_release_required_tenant(admin_user,default_org,default_facility):
    reviewer = get_user_model().objects.create_user(username='synthetic-migration-reviewer')
    UserProfile.objects.create(user=reviewer,organisation=default_org,role='COMPLIANCE_OFFICER')
    row = release(default_org,admin_user,reviewer)
    activate(admin_user,row,0,'Synthetic established release')
    default_org.requires_release=True; default_org.save()
    migration = import_module('tenancy.migrations.0006_preserve_existing_entitlements')
    migration.preserve_existing(apps,SimpleNamespace(connection=connection))
    assert entitlement(default_org)['basis'] == 'LEGACY_CONTINUITY'
    assert all(resolved(default_org)['modules'].values())
    assert ReleaseActivation.objects.get().release_id == row.pk
