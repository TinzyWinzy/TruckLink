"""Opt-in concurrent API benchmark on a disposable SQLite database.

RUN_LOAD_BENCHMARK=1 LOAD_REPORT=<path> python -m pytest
tests/test_load_benchmark.py -s --basetemp=<new workspace directory>
"""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from statistics import median

import pytest
from django.contrib.auth import get_user_model
from django.db import connections, connection
from django.test.utils import CaptureQueriesContext
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient
from trip.models import UserProfile
from yard.models import Alert, QueueEntry

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.skipif(
    os.environ.get('RUN_LOAD_BENCHMARK') != '1', reason='Opt-in load benchmark')]


@pytest.fixture(scope='session')
def django_db_modify_db_settings(django_db_modify_db_settings_parallel_suffix, tmp_path_factory):
    from django.conf import settings
    assert settings.DATABASES['default']['ENGINE'].endswith('sqlite3'), 'Local SQLite only'
    settings.DATABASES['default'].setdefault('TEST', {})['NAME'] = str(
        tmp_path_factory.mktemp('load-db') / 'isolated.sqlite3')


def test_concurrent_yard_reads(default_org, default_facility):
    actor = get_user_model().objects.create_user(username='load-operator')
    profile = UserProfile.objects.create(user=actor, organisation=default_org,
                                        role='OPERATIONS_SUPERVISOR')
    profile.facilities.add(default_facility)
    token = Token.objects.create(user=actor).key
    QueueEntry.objects.bulk_create([QueueEntry(organisation=default_org,
        facility=default_facility, reg_number=f'LOAD-{i:04}', status='QUEUED') for i in range(300)])
    Alert.objects.bulk_create([Alert(organisation=default_org, facility=default_facility,
        severity='WARNING', message=f'Synthetic alert {i}', acknowledged=True,
        acknowledged_by=actor) for i in range(100)])
    endpoints = [f'/api/yard/board/?facility={default_facility.pk}',
                 f'/api/queue/?facility={default_facility.pk}']

    def request(path):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Token {token}')
        started = time.perf_counter()
        try:
            response = client.get(path)
            return (time.perf_counter() - started) * 1000, response.status_code, len(response.content)
        finally:
            connections.close_all()

    query_counts = {}
    for path in endpoints:
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Token {token}')
        with CaptureQueriesContext(connection) as queries:
            response = client.get(path)
        assert response.status_code == 200, response.content
        query_counts[path] = len(queries)
        assert len(response.data['queue']) == 300
        if 'board' in path:
            assert len(response.data['alerts']) == 100
            assert all(a['acknowledged_by'] == actor.username for a in response.data['alerts'])

    runs = []
    for workers in (1, 4, 8):
        started = time.perf_counter()
        with ThreadPoolExecutor(max_workers=workers) as pool:
            samples = list(pool.map(request, [endpoints[i % 2] for i in range(48)]))
        elapsed = time.perf_counter() - started
        latencies = sorted(s[0] for s in samples)
        runs.append({'concurrency': workers, 'requests': len(samples),
            'requests_per_second': round(len(samples) / elapsed, 2),
            'median_ms': round(median(latencies), 2),
            'p95_ms': round(latencies[int((len(latencies)-1)*.95)], 2),
            'max_ms': round(max(latencies), 2),
            'errors': sum(s[1] != 200 for s in samples),
            'response_bytes': sorted(set(s[2] for s in samples))})
        assert all(s[1] == 200 for s in samples), samples
    report = {'dataset': {'queue_entries': 300, 'acknowledged_alerts': 100},
        'transport': 'Django test client; real token auth, middleware, ORM and JSON rendering; no network',
        'database': 'disposable file SQLite', 'query_counts': query_counts, 'runs': runs}
    destination = Path(os.environ['LOAD_REPORT'])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
