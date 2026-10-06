"""Disposable configurations and invented regulatory content only; no customer onboarding."""
from copy import deepcopy
from datetime import timedelta
from importlib import import_module
from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APIClient
import pytest
from core.models import Facility, OutboxEvent
from core.audit import verify_chain
from tenancy.configuration import defaults, resolved
from tenancy.models import TenantConfiguration, TenantArtifactRevision, ArtifactReview, TenantReleaseVersion, ReleaseActivation, WorkflowExecution
from tenancy.registry import MODULES, TEMPLATES
from tenancy.releases import activate, snapshot, module_enabled
from regulatory.knowledge import KnowledgeRevision, KnowledgeReview, GovernanceEvent, rou_snapshot
from regulatory.engine.evaluator import digest
from regulatory import services as s
from trip.models import Organisation, UserProfile
from tests.test_regulatory import domain, inspect
from tests.test_auth_tenancy import admin_user, admin_client

pytestmark = pytest.mark.django_db


def revision(org,kind,key,content,actor=None,facility=None):
    last = TenantArtifactRevision.objects.filter(organisation=org,kind=kind,key=key).order_by('-version').first()
    return TenantArtifactRevision.objects.create(organisation=org,creator=actor,kind=kind,key=key,version=last.version+1 if last else 1,
        content=content,digest=digest(content),reason='Synthetic architecture test',facility=facility)


def release(org,actor,reviewer=None,modules=None,extra=()):
    content = defaults(); content['branding']['display_name'] = org.name
    config = TenantConfiguration.objects.create(organisation=org,version=1,content=content,digest=digest(content),reason='Synthetic baseline')
    module = revision(org,'MODULES','modules',modules or dict.fromkeys(MODULES,True),actor)
    workflow = revision(org,'WORKFLOW','yard',{'template':'yard-lifecycle-v1','transitions':TEMPLATES['yard-lifecycle-v1']['transitions'],
        'workflow':content['workflow']},actor)
    ArtifactReview.objects.create(organisation=org,creator=reviewer,artifact=workflow,approved=True,reason='Independent synthetic workflow review')
    ids = [module.pk,workflow.pk,*[r.pk for r in extra]]
    row = TenantReleaseVersion.objects.create(organisation=org,creator=actor,version=1,configuration=config,artifact_ids=ids,
        digest=digest({'configuration_id':config.pk,'artifact_ids':ids}),reason='Synthetic release')
    return row


def new_version(old,actor,ids):
    latest = TenantReleaseVersion.objects.filter(organisation=old.organisation).order_by('-version').first()
    return TenantReleaseVersion.objects.create(organisation=old.organisation,creator=actor,version=latest.version+1,
        configuration=old.configuration,artifact_ids=ids,digest=digest({'configuration_id':old.configuration_id,'artifact_ids':ids}),reason='Synthetic revision')


def platform_pack():
    author = get_user_model().objects.create_superuser(username='synthetic-custodian-author',password='synthetic-only')
    reviewer = get_user_model().objects.create_superuser(username='synthetic-custodian-reviewer',password='synthetic-only')
    def create(kind,key,content):
        row = KnowledgeRevision.objects.create(creator=author,kind=kind,key=key,version=1,content=content,digest=digest(content),reason='Invented software test; not verified law')
        KnowledgeReview.objects.create(creator=reviewer,revision=row,approved=True,reason='Independent synthetic test review')
        return row
    today = timezone.now().date()
    start = (today-timedelta(days=1)).isoformat(); end = (today+timedelta(days=10)).isoformat()
    source = create('SOURCE','invented-source',{'title':'Invented test document','authority':'Synthetic authority','jurisdiction':'TEST',
        'kind':'STATUTE','tier':'A','provision':'TEST ONLY','document_ref':'test://invented','document_sha256':'a'*64,
        'published_on':start,'effective_from':start,'effective_to':end})
    rou = create('ROU','invented-gross',{'source_id':source.pk,'definition':{'kind':'GROSS_MAX','limit_kg':'25000',
        'applicability':{},'failure_action':'QUARANTINE','override_policy':'NOT_ALLOWED'}})
    pack = create('PACK','invented-pack',{'name':'Synthetic pack','version':1,'jurisdiction':'TEST','route_type':'DOMESTIC',
        'effective_from':start,'effective_to':end,'max_age_seconds':3600,'schema_version':1,'rou_ids':[rou.pk],'units':[rou_snapshot(rou)]})
    return pack,source,author,reviewer


def test_bak_migration_preserves_identity_config_and_only_creates_reference(default_org,default_facility):
    bak = Organisation.objects.create(slug='bak-operations',name='BAK Operations')
    site = Facility.objects.create(organisation=bak,slug='bak-main-yard',name='BAK Main Yard',yard_config={'mode':'OPERATIONS'},timezone='Africa/Harare')
    c = defaults(); c['branding']['display_name'] = 'BAK Logistics'; c['workflow']['inspection_max_age_seconds'] = 3600
    TenantConfiguration.objects.create(organisation=bak,version=1,content=c,digest=digest(c),reason='Preserved baseline')
    migration = import_module('tenancy.migrations.0004_bak_compatibility_release')
    migration.preserve_bak(apps,None); migration.preserve_bak(apps,None)
    assert TenantReleaseVersion.objects.filter(organisation=bak).count() == 1
    assert not TenantReleaseVersion.objects.filter(organisation=default_org).exists()
    assert resolved(bak)['content']['workflow']['inspection_max_age_seconds'] == 3600
    assert resolved(bak)['content']['branding']['display_name'] == 'BAK Logistics'
    site.refresh_from_db(); assert site.yard_config == {'mode':'OPERATIONS'}
    assert module_enabled(bak,'routing')
    policy = TenantArtifactRevision.objects.get(organisation=bak,kind='POLICY')
    assert policy.content['classification'] == 'TENANT_POLICY'
    assert KnowledgeRevision.objects.count() == 0
    assert not Organisation.objects.filter(slug__icontains='trinitas').exists()


def test_module_and_workflow_schema_reject_unsafe_configuration(domain):
    d = domain; modules = dict.fromkeys(MODULES,True); modules['fleet'] = False
    with pytest.raises(ValidationError,match='dependent'):
        revision(d['org'],'MODULES','unsafe',modules,d['author'])
    flow = {'template':'yard-lifecycle-v1','transitions':['arrival','release'],'workflow':defaults()['workflow']}
    with pytest.raises(ValidationError,match='transitions'):
        revision(d['org'],'WORKFLOW','unsafe',flow,d['author'])
    with pytest.raises(ValidationError):
        revision(d['org'],'WORKFLOW','code',{'python':'release_all()'},d['author'])
    with pytest.raises(ValidationError):
        revision(d['org'],'PERMISSIONS','grant',{'grants':{'queue.create':['EXECUTIVE']}},d['author'])


def test_atomic_activation_module_denial_historical_read_and_outbox_retention(domain):
    d = domain
    modules = dict.fromkeys(MODULES,True); modules['routing'] = False; modules['notifications'] = False
    row = release(d['org'],d['author'],d['reviewer'],modules)
    activate(d['author'],row,0,'Enable synthetic configuration')
    with pytest.raises(ValidationError,match='changed'):
        activate(d['author'],row,0,'Stale activation')
    client = APIClient(); client.force_authenticate(d['author'])
    assert client.get('/api/routes/workspace/',{'facility':d['default_facility'].pk}).status_code == 200
    assert client.post('/api/routes/drafts/',{'facility':d['default_facility'].pk},format='json').status_code == 403
    event = OutboxEvent.objects.create(organisation=d['org'],facility=d['default_facility'],event_type='TEST',payload={})
    from core.notify import run
    assert run()['done'] == 0
    event.refresh_from_db(); assert event.status == 'PENDING' and event.attempts == 0
    assert verify_chain(d['default_facility'])['ok']


def test_inspection_pins_release_and_workflow_events_and_site_change_blocks_release(domain):
    d = domain
    row = release(d['org'],d['author'],d['reviewer'])
    activate(d['author'],row,0,'Synthetic activation')
    attempt = inspect(d)
    assert attempt.decision == 'PASS'
    assert attempt.tenant_configuration_snapshot['release_id'] == row.pk
    execution = WorkflowExecution.objects.get(queue_entry=d['entry'])
    assert execution.release_id == row.pk and execution.events.get().transition == 'inspect'
    site = revision(d['org'],'SITE','site',{'timezone':'UTC','operating_parameters':{'mode':'OPERATIONS'}},d['author'],d['default_facility'])
    changed = new_version(row,d['author'],[*row.artifact_ids,site.pk]); activate(d['author'],changed,1,'Site revision')
    from yard.services import release_entry,ReleaseBlocked
    with pytest.raises(ReleaseBlocked,match='changed'):
        release_entry(d['entry'].pk,d['inspector'])
    assert attempt.tenant_configuration_snapshot['release_id'] == row.pk


def test_tenant_policy_hold_is_distinct_from_regulatory_pack_and_approval_required(domain):
    d = domain
    policy = revision(d['org'],'POLICY','load-seal',{'classification':'TENANT_POLICY','document_ref':'test://company-policy','document_sha256':'b'*64,
        'controls':[{'key':'load-seal','definition':{'kind':'CHECKLIST','item_id':'load-seal','applicability':{},'failure_action':'HOLD','override_policy':'NOT_ALLOWED'}}]},d['author'])
    with pytest.raises(ValidationError,match='independent'):
        release(d['org'],d['author'],d['reviewer'],extra=[policy])
    ArtifactReview.objects.create(organisation=d['org'],creator=d['reviewer'],artifact=policy,approved=True,reason='Synthetic independent company policy review')
    # Failed release publication is atomic at the API; model-level helper retained its draft config.
    config = TenantConfiguration.objects.get(organisation=d['org'])
    rows = list(TenantArtifactRevision.objects.filter(organisation=d['org'],kind__in=['MODULES','WORKFLOW']))
    ids = [*[r.pk for r in rows],policy.pk]
    row = TenantReleaseVersion.objects.create(organisation=d['org'],creator=d['author'],version=1,configuration=config,artifact_ids=ids,
        digest=digest({'configuration_id':config.pk,'artifact_ids':ids}),reason='Reviewed synthetic policy release')
    activate(d['author'],row,0,'Synthetic activation')
    attempt = inspect(d)
    assert attempt.decision == 'HOLD' and not attempt.result['override_eligible']
    controls = [c for c in attempt.result['controls'] if (c.get('provenance') or {}).get('source',{}).get('classification') == 'TENANT_POLICY']
    assert controls and controls[0]['provenance']['source']['kind'] == 'INTERNAL_POLICY'
    assert attempt.result['monetary_penalty'] is None


def test_native_platform_pack_assignment_and_revocation_without_tenant_evidence_sharing(domain):
    d = domain; pack,source,author,reviewer = platform_pack()
    assignment = revision(d['org'],'PACK_ASSIGNMENT','test-domestic',{'pack_id':pack.pk,'jurisdiction':'TEST','route_type':'DOMESTIC'},d['author'])
    row = release(d['org'],d['author'],d['reviewer'],extra=[assignment]); activate(d['author'],row,0,'Assign invented pack')
    attempt = inspect(d)
    assert attempt.decision == 'PASS' and attempt.ruleset_snapshot[0]['id'] == f'pack:{pack.pk}'
    assert not hasattr(pack,'organisation_id')
    KnowledgeReview.objects.create(creator=reviewer,revision=source,approved=False,reason='Revoke synthetic source')
    from yard.services import release_entry,ReleaseBlocked
    with pytest.raises(ReleaseBlocked,match='revoked'):
        release_entry(d['entry'].pk,d['inspector'])


def test_foreign_artifacts_sites_and_configuration_cannot_be_published(domain):
    d = domain; other = Organisation.objects.create(name='Disposable Other',slug='disposable-other')
    foreign = revision(other,'MODULES','modules',dict.fromkeys(MODULES,True))
    row = release(d['org'],d['author'],d['reviewer'])
    with pytest.raises(ValidationError,match='foreign'):
        new_version(row,d['author'],[foreign.pk])
    other_site = Facility.objects.create(organisation=other,name='Other Yard',slug='other-yard')
    with pytest.raises(ValidationError,match='another tenant'):
        revision(d['org'],'SITE','foreign',{'timezone':'UTC','operating_parameters':{}},d['author'],other_site)


def test_platform_api_requires_custodian_and_governance_chain_has_no_tenant_records(admin_client):
    assert admin_client.post('/api/regulatory/knowledge/',{},format='json').status_code == 403
    pack,source,author,reviewer = platform_pack()
    client = APIClient(); client.force_authenticate(reviewer)
    response = client.post(f'/api/regulatory/knowledge/{source.pk}/review/',{'approved':False,'reason':'Synthetic revocation'},format='json')
    assert response.status_code == 201
    event = GovernanceEvent.objects.get(); assert event.action == 'REVOKE' and event.previous_hash == 'GENESIS'
    assert not hasattr(event,'organisation_id')
    assert admin_client.get('/api/regulatory/governance-audit/').status_code == 403


def test_configuration_api_keeps_branding_changes_out_of_decision_digest(domain):
    d = domain
    row = release(d['org'],d['author'],d['reviewer']); activate(d['author'],row,0,'Synthetic activation')
    before = snapshot(d['org'],d['default_facility'])
    content = deepcopy(resolved(d['org'])['content']); content['branding']['display_name'] = 'Synthetic New Branding'
    client = APIClient(); client.force_authenticate(d['author'])
    response = client.post('/api/tenant/configuration/',{'content':content,'expected_version':1,'reason':'Brand only'},format='json')
    assert response.status_code == 201
    assert snapshot(d['org'],d['default_facility'])['decision_digest'] == before['decision_digest']
    assert resolved(d['org'])['content']['branding']['display_name'] == 'Synthetic New Branding'
    content['workflow']['mandatory_checks'].append('load-seal')
    assert client.post('/api/tenant/configuration/',{'content':content,'expected_version':2,'reason':'Unreviewed workflow change'},format='json').status_code == 409


def test_workflow_revocation_records_review_required_attempt_without_losing_audit(domain):
    d = domain; row = release(d['org'],d['author'],d['reviewer']); activate(d['author'],row,0,'Synthetic activation')
    workflow = TenantArtifactRevision.objects.get(organisation=d['org'],kind='WORKFLOW')
    ArtifactReview.objects.create(organisation=d['org'],creator=d['reviewer'],artifact=workflow,approved=False,reason='Revoke synthetic workflow')
    attempt = inspect(d)
    assert attempt.decision == 'REVIEW_REQUIRED'
    assert WorkflowExecution.objects.get(queue_entry=d['entry']).events.get().configuration_snapshot['readiness_errors']
    assert verify_chain(d['default_facility'])['ok']


def test_site_workflow_precedence_and_permission_profile_are_enforced(domain):
    d = domain; row = release(d['org'],d['author'],d['reviewer'])
    local = deepcopy(defaults()['workflow']); local['mandatory_checks'].append('site-seal')
    workflow = revision(d['org'],'WORKFLOW','local-yard',{'template':'yard-lifecycle-v1','transitions':TEMPLATES['yard-lifecycle-v1']['transitions'],'workflow':local},d['author'],d['default_facility'])
    ArtifactReview.objects.create(organisation=d['org'],creator=d['reviewer'],artifact=workflow,approved=True,reason='Local synthetic workflow review')
    permissions = revision(d['org'],'PERMISSIONS','local-grants',{'grants':{'queue.create':[],'regulatory.inspect':[]}},d['author'],d['default_facility'])
    changed = new_version(row,d['author'],[*row.artifact_ids,workflow.pk,permissions.pk]); activate(d['author'],changed,0,'Local configuration')
    from tenancy.configuration import workflow as effective_workflow
    assert 'site-seal' in effective_workflow(d['org'],d['default_facility'])['mandatory_checks']
    assert 'site-seal' not in effective_workflow(d['org'])['mandatory_checks']
    client = APIClient(); client.force_authenticate(d['inspector'])
    assert client.post('/api/queue/',{'facility':d['default_facility'].pk,'reg_number':'SYNTHETIC'},format='json').status_code == 403
    with pytest.raises(PermissionError,match='Tenant policy'):
        inspect(d)


def test_new_tenant_registration_requires_configured_release_before_operating(api_client):
    response = api_client.post('/api/tenancy/signup/',{'organisation_name':'Disposable onboarding','facility_name':'Discovered Yard',
        'username':'synthetic-onboarding-admin','password':'synthetic-test-only'},format='json')
    assert response.status_code == 201
    org = Organisation.objects.get(slug='disposable-onboarding')
    assert org.requires_release and not module_enabled(org,'fleet') and module_enabled(org,'audit')
    assert not resolved(org)['modules']['yard']
    assert TenantReleaseVersion.objects.filter(organisation=org).count() == 0


def test_internal_policy_import_and_unsafe_site_downgrade_are_rejected(domain):
    d = domain; actor = get_user_model().objects.create_superuser(username='synthetic-import-custodian',password='synthetic')
    client = APIClient(); client.force_authenticate(actor)
    response = client.post('/api/regulatory/knowledge/import-legacy/',{'kind':'SOURCE','legacy_id':d['source'].pk,'reason':'No statutory promotion'},format='json')
    assert response.status_code == 409 and 'Internal policies' in response.json()['error']
    with pytest.raises(ValidationError,match='downgraded'):
        revision(d['org'],'SITE','unsafe-demo',{'timezone':'UTC','operating_parameters':{'mode':'DEMO'}},d['author'],d['default_facility'])


def test_explicit_legacy_statute_import_keeps_original_digest_and_creates_unapproved_platform_draft(domain):
    d = domain
    from regulatory.models import SourceRevision
    from regulatory.services import source_snapshot
    from regulatory.knowledge import LegacyKnowledgeMap
    old = SourceRevision.objects.create(organisation=d['org'],creator=d['author'],source_key='invented-legacy-statute',revision=1,
        title='Invented migration fixture; not law',authority='Synthetic',jurisdiction='TEST',kind='STATUTE',tier='A',provision='TEST ONLY',
        document_ref='test://invented-legacy',document_sha256='c'*64,published_on=timezone.now().date(),effective_from=timezone.now().date())
    original = digest(source_snapshot(old))
    actor = get_user_model().objects.create_superuser(username='synthetic-map-operator',password='synthetic-only')
    client = APIClient(); client.force_authenticate(actor)
    response = client.post('/api/regulatory/knowledge/import-legacy/',{'kind':'SOURCE','legacy_id':old.pk,'reason':'Explicit synthetic draft import'},format='json')
    assert response.status_code == 201 and response.json()['approved'] is False
    mapping = LegacyKnowledgeMap.objects.get(legacy_id=old.pk)
    assert mapping.legacy_digest == original and not mapping.revision.reviews.exists()
    old.refresh_from_db(); assert digest(source_snapshot(old)) == original
    assert client.post('/api/regulatory/knowledge/import-legacy/',{'kind':'SOURCE','legacy_id':old.pk,'reason':'Duplicate'},format='json').status_code == 409


def test_release_api_requires_independent_review_and_explicit_activation(domain):
    d = domain
    content = defaults()
    config = TenantConfiguration.objects.create(organisation=d['org'],version=1,content=content,digest=digest(content),reason='Synthetic configuration')
    author = APIClient(); author.force_authenticate(d['author'])
    reviewer = APIClient(); reviewer.force_authenticate(d['reviewer'])
    data = {'kind':'MODULES','key':'modules','expected_version':0,'content':dict.fromkeys(MODULES,True),'reason':'Synthetic authoring'}
    response = author.post('/api/tenant/revisions/',data,format='json'); assert response.status_code == 201
    module_id = response.json()['revision']['id']
    data = {'kind':'WORKFLOW','key':'yard','expected_version':0,'content':{'template':'yard-lifecycle-v1','transitions':TEMPLATES['yard-lifecycle-v1']['transitions'],'workflow':content['workflow']},'reason':'Synthetic workflow authoring'}
    response = author.post('/api/tenant/revisions/',data,format='json'); assert response.status_code == 201
    workflow_id = response.json()['revision']['id']
    assert author.post(f'/api/tenant/revisions/{workflow_id}/review/',{'approved':True,'reason':'Self review'},format='json').status_code == 409
    publication = {'configuration_id':config.pk,'artifact_ids':[module_id,workflow_id],'expected_version':0,'reason':'Synthetic publication'}
    assert author.post('/api/tenant/releases/',publication,format='json').status_code == 409
    assert reviewer.post(f'/api/tenant/revisions/{workflow_id}/review/',{'approved':True,'reason':'Independent review'},format='json').status_code == 201
    response = author.post('/api/tenant/releases/',publication,format='json'); assert response.status_code == 201
    assert ReleaseActivation.objects.count() == 0
    release_id = response.json()['release']['id']
    assert author.post(f'/api/tenant/releases/{release_id}/activate/',{'expected_version':0,'reason':'Explicit activation'},format='json').status_code == 201
    assert author.post(f'/api/tenant/releases/{release_id}/activate/',{'expected_version':0,'reason':'Stale replay'},format='json').status_code == 409
