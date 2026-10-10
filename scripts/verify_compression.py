"""Read-only compression checks; optional existing session supplied through env."""
import argparse
import gzip
import json
import os
import re
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen


class NoAuthenticatedRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ValueError('Authenticated verification does not follow redirects')


def fetch(url, accept_encoding, token=None):
    started = time.perf_counter()
    headers = {'Accept-Encoding': accept_encoding, 'User-Agent': 'Trucki-Compression-Verification/1'}
    if token:
        if urlparse(url).scheme != 'https':
            raise ValueError('Authenticated verification requires HTTPS')
        headers['Authorization'] = f'Token {token}'
    request = Request(url, headers=headers)
    try:
        response = build_opener(NoAuthenticatedRedirects()).open(request, timeout=45) if token else urlopen(request, timeout=45)
    except HTTPError as error:
        response = error
    with response:
        raw = response.read(10_000_001)
        if len(raw) > 10_000_000:
            raise ValueError('Response exceeds verification limit')
        headers = {key: response.headers.get(key) for key in
                   ('Content-Encoding', 'Content-Type', 'Content-Length', 'Vary', 'Cache-Control')}
        encoding = headers['Content-Encoding']
        decoded = gzip.decompress(raw) if encoding == 'gzip' else raw if not encoding else None
        return {'url': url, 'requested_encoding': accept_encoding, 'status': response.status,
            'headers': headers, 'wire_body_bytes': len(raw),
            'decoded_bytes': len(decoded) if decoded is not None else None,
            'elapsed_ms': round((time.perf_counter()-started)*1000, 2)}, decoded


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--web', default='https://trucki-two.vercel.app')
    parser.add_argument('--api', default='https://spotteraiassessment-khaj.onrender.com')
    parser.add_argument('--output', default='docs/analysis/trucki-deployed-compression.json')
    parser.add_argument('--token-env', help='Name of an environment variable containing an existing API token; never printed')
    parser.add_argument('--facility', default='1')
    args = parser.parse_args()
    token = os.environ.get(args.token_env) if args.token_env else None
    if args.token_env and not token:
        raise ValueError('Requested token environment variable is empty')
    records = []
    index, content = fetch(args.web+'/', 'identity')
    records.append(index)
    if index['status'] != 200 or content is None:
        raise ValueError('Public frontend index could not be inspected')
    asset = re.search(r'<script[^>]+src="([^\"]+\.js)"', content.decode('utf-8'))
    if not asset or not asset.group(1).startswith('/assets/'):
        raise ValueError('No built frontend script found')
    for encoding in ('identity', 'gzip', 'br'):
        record, _ = fetch(args.web+asset.group(1), encoding)
        records.append(record)
    board_path = '/api/yard/board/?'+urlencode({'facility': args.facility, 'scope': 'active', 'compact': '1'})
    for path in ('/api/health/',) if token else ('/api/health/', board_path):
        record, _ = fetch(args.api+path, 'gzip')
        records.append(record)
    verified = False
    if token:
        boards = []
        for encoding in ('identity', 'gzip'):
            record, body = fetch(args.api+board_path, encoding, token)
            records.append(record)
            if record['status'] != 200 or body is None:
                raise ValueError('Authenticated board verification requires a successful decodable response')
            data = json.loads(body)
            if not isinstance(data.get('queue'), list):
                raise ValueError('Expected a yard board response')
            boards.append((record, data))
        verified = (boards[1][0]['headers']['Content-Encoding'] == 'gzip'
            and boards[1][0]['decoded_bytes'] >= 1024 and boards[0][1] == boards[1][1])
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    report = {'authenticated': bool(token), 'checks': records, 'authenticated_api_compression_verified': verified,
        'limitation': ('API verification requires gzip, at least 1 KiB decoded and equal identity/gzip board data; repeat on a quiet synthetic fixture if it changes.' if token else
            'Unauthenticated board read only verifies access rejection. Large authenticated API response compression remains unverified.')}
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
