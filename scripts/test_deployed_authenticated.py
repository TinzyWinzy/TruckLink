"""Provision an isolated demo tenant and record secret-free compression evidence."""
import json
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, build_opener

from verify_compression import NoAuthenticatedRedirects, fetch

API = 'https://spotteraiassessment-khaj.onrender.com'


def post(path, data, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Token ' + token
    request = Request(API + path, data=json.dumps(data).encode(), headers=headers)
    try:
        response = build_opener(NoAuthenticatedRedirects()).open(request, timeout=60)
    except HTTPError as error:
        response = error
    with response:
        return response.status, json.loads(response.read())


def main():
    suffix = secrets.token_hex(5)
    credentials = {'username': 'trucki-perf-' + suffix, 'password': secrets.token_urlsafe(32)}
    status, account = post('/api/tenancy/signup/', {
        **credentials, 'organisation_name': 'Trucki Performance Test ' + suffix,
        'facility_name': 'Synthetic Performance Yard ' + suffix, 'facility_mode': 'DEMO',
    })
    if status != 201:
        print(json.dumps({'stage': 'signup', 'status': status, 'errors': account.get('errors', account.get('error'))}))
        return 1
    private = Path('backend/.test-tmp/deployed-test-credentials.json')
    private.parent.mkdir(parents=True, exist_ok=True)
    private.write_text(json.dumps({**credentials, 'api': API, 'facility': account['facility'],
        'organisation': account['organisation']}, indent=2), encoding='utf-8')
    token = account['token']
    facility = str(account['facility']['id'])
    seed_status, seed = post('/api/admin/seed/', {'facility': facility}, token)
    checks, bodies = [], []
    path = '/api/yard/board/?facility=' + facility + '&scope=active&compact=1'
    for encoding in ('identity', 'gzip'):
        record, body = fetch(API + path, encoding, token)
        checks.append(record)
        bodies.append(json.loads(body) if body else None)
    unauthenticated, _ = fetch(API + path, 'gzip')
    success = all(row['status'] == 200 for row in checks)
    equal = success and bodies[0] == bodies[1]
    compressed = checks[1]['headers']['Content-Encoding'] == 'gzip'
    report = {'tested_at': datetime.now(timezone.utc).isoformat(),
        'tenant': account['organisation']['slug'], 'facility_id': facility,
        'seed_status': seed_status, 'seed_error': seed.get('error'), 'checks': checks,
        'unauthenticated_status': unauthenticated['status'], 'authenticated_success': success,
        'identity_gzip_json_equal': equal,
        'authenticated_api_compression_verified': bool(equal and compressed and checks[1]['decoded_bytes'] >= 1024),
        'queue_rows': len(bodies[0].get('queue', [])) if success else None,
        'wire_reduction_percent': round(100 * (1 - checks[1]['wire_body_bytes'] / checks[0]['wire_body_bytes']), 2) if success else None,
        'limitation': 'Two sequential reads of an isolated demo tenant; not a load or latency benchmark. Current production deployment only.'}
    logout_status, _ = post('/api/auth/logout/', {}, token)
    report['logout_status'] = logout_status
    output = Path('docs/analysis/trucki-authenticated-compression.json')
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(main())
