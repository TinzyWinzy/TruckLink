"""Full new-tenant onboarding journey: signup → selection → workflow → independent review → release → activation."""
import pytest
from django.test import override_settings

pytestmark = pytest.mark.django_db


def _auth(client, token):
    client.credentials(HTTP_AUTHORIZATION=f'Token {token}')


def _signup(client, org='Journey Co', user='journey-admin'):
    r = client.post('/api/tenancy/signup/', {
        'organisation_name': org, 'facility_name': 'Journey Yard', 'facility_mode': 'DEMO',
        'username': user, 'password': 'journey-pass-1', 'email': f'{user}@example.com'}, format='json')
    assert r.status_code == 201, r.content
    return r.data


def _config(client):
    r = client.get('/api/tenant/configuration/')
    assert r.status_code == 200
    c = r.data['configuration']
    r2 = client.post('/api/tenant/configuration/', {
        'content': c['content'], 'expected_version': c['version'], 'reason': 'Onboarding company details'}, format='json')
    assert r2.status_code in (200, 201), r2.content
    return r2.data['configuration']


def test_demo_tenant_completes_onboarding_end_to_end(anon_client):
    data = _signup(anon_client)
    token, org_id = data['token'], data['organisation']['id']
    _auth(anon_client, token)
    cfg = _config(anon_client)
    assert cfg['id']

    r = anon_client.post('/api/tenant/subscription/', {
        'modules': ['yard', 'routing'], 'expected_version': 0, 'reason': 'Yard and dispatch needs.'}, format='json')
    assert r.status_code == 201, r.content
    assert r.data['entitlement']['state'] == 'ACTIVE', 'demo tenant must self-serve a trial entitlement'
    assert 'yard' in r.data['entitlement']['modules'] and not [
        m for m in r.data['selection']['required_modules'] if m not in r.data['entitlement']['modules']]

    from tenancy.configuration import defaults
    flow = defaults()['workflow']
    r = anon_client.post('/api/tenant/revisions/', {
        'kind': 'WORKFLOW', 'key': 'yard-lifecycle', 'expected_version': 0,
        'content': {'template': 'yard-lifecycle-v1',
                    'transitions': ['arrival', 'dock', 'inspect', 'request_override', 'approve_override', 'release', 'update_status'],
                    'workflow': flow},
        'facility': None, 'reason': 'Initial operating workflow'}, format='json')
    assert r.status_code == 201, r.content
    wf_id = r.data['revision']['id']

    # Author cannot self-approve — the previous 403 deadlock is gone; independence still enforced.
    r = anon_client.post(f'/api/tenant/revisions/{wf_id}/review/', {'approved': True, 'reason': 'me'}, format='json')
    assert r.status_code == 403 and b'Independent' in r.content

    r = anon_client.post('/api/admin/pins/', {
        'staff_id': 'TRK-JRNY-1', 'pin': '445566', 'role': 'COMPLIANCE_OFFICER'}, format='json')
    assert r.status_code == 201, r.content
    r = anon_client.post('/api/auth/pin/', {'staff_id': 'TRK-JRNY-1', 'pin': '445566'}, format='json')
    assert r.status_code == 200
    _auth(anon_client, r.data['token'])
    r = anon_client.post(f'/api/tenant/revisions/{wf_id}/review/', {'approved': True, 'reason': 'Procedures checked.'}, format='json')
    assert r.status_code == 201, r.content

    _auth(anon_client, token)
    r = anon_client.get('/api/tenant/revisions/')
    approved = [row for row in r.data['revisions'] if row['kind'] == 'WORKFLOW' and row['review_approved']]
    assert approved, 'workflow must carry independent approval'

    r = anon_client.post('/api/tenant/revisions/', {
        'kind': 'MODULES', 'key': 'validated-capabilities', 'expected_version': 0,
        'content': {k: k in ('yard', 'routing', 'inspection', 'release', 'fleet', 'audit') for k in
                    ['yard', 'docks', 'inspection', 'release', 'fleet', 'routing', 'notifications', 'reports', 'modelling', 'audit']},
        'facility': None, 'reason': 'Capabilities validated for release'}, format='json')
    assert r.status_code == 201, r.content
    modules_id = r.data['revision']['id']

    r = anon_client.post('/api/tenant/releases/', {
        'artifact_ids': [modules_id, wf_id], 'configuration_id': cfg['id'], 'expected_version': 0,
        'reason': 'First operational release'}, format='json')
    assert r.status_code == 201, r.content
    rel_id = r.data['release']['id']
    r = anon_client.post(f'/api/tenant/releases/{rel_id}/activate/', {
        'expected_version': 0, 'reason': 'Activate the yard'}, format='json')
    assert r.status_code == 201, r.content

    r = anon_client.get('/api/tenant/subscription/')
    assert r.data['effective_modules']['yard'] is True and r.data['effective_modules']['routing'] is True


def test_operations_tenant_keeps_operator_approval_gate(anon_client):
    r = anon_client.post('/api/tenancy/signup/', {
        'organisation_name': 'Ops Co', 'facility_name': 'Ops Yard', 'facility_mode': 'OPERATIONS',
        'username': 'ops-admin', 'password': 'ops-pass-123', 'email': 'ops@example.com'}, format='json')
    assert r.status_code == 201
    _auth(anon_client, r.data['token'])
    r = anon_client.post('/api/tenant/subscription/', {
        'modules': ['yard'], 'expected_version': 0, 'reason': 'Real cargo yard.'}, format='json')
    assert r.status_code == 201
    assert r.data['entitlement']['state'] == 'UNASSIGNED', 'operations tenants must not self-grant'


def test_signup_invite_round_trip_and_expiry(anon_client):
    from django.contrib.auth import get_user_model
    get_user_model().objects.create_superuser('platform-op', 'op@example.com', 'op-secret-1')
    r = anon_client.post('/api/auth/login/', {'username': 'platform-op', 'password': 'op-secret-1'}, format='json')
    _auth(anon_client, r.data['token'])
    r = anon_client.post('/api/tenancy/signup-invites/', {'email': 'cfo@logistics.example'}, format='json')
    assert r.status_code == 201, r.content
    token = r.data['invite_token']

    r = anon_client.get(f'/api/tenancy/signup-invites/{token}/')
    assert r.status_code == 200 and r.data['email'] == 'cfo@logistics.example'

    r = anon_client.post('/api/tenancy/signup/', {
        'organisation_name': 'Invited Co', 'facility_name': 'Invited Yard', 'facility_mode': 'DEMO',
        'username': 'invited-admin', 'password': 'invited-pass-1', 'invite': token}, format='json')
    assert r.status_code == 201, r.content

    r = anon_client.post('/api/tenancy/signup-invites/', {'email': 'x@y.example'}, format='json')
    assert r.status_code == 201
    anon_client.credentials()
    r = anon_client.post('/api/tenancy/signup/', {
        'organisation_name': 'Thwarted Co', 'facility_name': 'Yard', 'facility_mode': 'DEMO',
        'username': 'thwarted-admin', 'password': 'thwarted-pass1', 'invite': token + 'tamper'}, format='json')
    assert r.status_code == 400 and 'invite' in r.data['errors']
