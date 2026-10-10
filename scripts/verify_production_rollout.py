"""Read-only rollout checks using the existing isolated demo account."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from test_deployed_authenticated import API, post
from verify_compression import fetch


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', choices=['before', 'after'], required=True)
    args = parser.parse_args()
    credentials = json.loads(Path('backend/.test-tmp/deployed-test-credentials.json').read_text())
    status, login = post('/api/auth/login/', {key: credentials[key] for key in ('username', 'password')})
    if status != 200:
        raise RuntimeError(f'Login failed: HTTP {status}')
    token = login['token']
    facility = credentials['facility']['id']
    path = f'/api/yard/board/?facility={facility}'
    report = {'phase': args.phase, 'at': datetime.now(timezone.utc).isoformat(), 'checks': {}}
    bodies = {}
    try:
        for name, query, encoding in (
            ('full', '', 'identity'),
            ('compact', '&scope=active&compact=1', 'identity'),
            ('gzip', '&scope=active&compact=1', 'gzip'),
        ):
            record, body = fetch(API + path + query, encoding, token)
            report['checks'][name] = record
            if record['status'] != 200:
                raise RuntimeError(f'{name}: HTTP {record["status"]}')
            bodies[name] = json.loads(body)
        record, _ = fetch(API + path, 'gzip')
        report['unauthenticated_status'] = record['status']
        compact = bodies['compact']['queue']
        report['queue_rows'] = {key: len(value['queue']) for key, value in bodies.items()}
        report['compact_omits_metadata'] = bool(compact) and all(
            not {'facility', 'created_at', 'idempotency_key'}.intersection(row) for row in compact)
        report['identity_gzip_equal'] = bodies['compact'] == bodies['gzip']
        report['gzip_verified'] = (report['identity_gzip_equal']
            and report['checks']['gzip']['headers']['Content-Encoding'] == 'gzip')
        report['no_store'] = all('no-store' in (row['headers']['Cache-Control'] or '')
            for row in report['checks'].values())
        report['compact_body_bytes'] = report['checks']['compact']['wire_body_bytes']
        report['gzip_body_bytes'] = report['checks']['gzip']['wire_body_bytes']
        report['limitations'] = 'Small unchanged demo fixture; single samples are not a latency benchmark. No load or operational writes.'
    finally:
        report['logout_status'], _ = post('/api/auth/logout/', {}, token)
    output = Path(f'docs/analysis/trucki-production-{args.phase}.json')
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    if args.phase == 'after':
        assert all(report[key] for key in ('compact_omits_metadata', 'gzip_verified', 'no_store'))
        assert report['unauthenticated_status'] == 401 and report['logout_status'] == 200


if __name__ == '__main__':
    main()
