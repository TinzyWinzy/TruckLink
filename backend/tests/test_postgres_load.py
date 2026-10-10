"""Opt-in PostgreSQL mixed load: synthetic tenants; pytest owns the test DB."""
import json
import os
import time
import tracemalloc
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from statistics import median

import pytest
from django.contrib.auth import get_user_model
from django.db import connection, connections
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from core.audit import verify_chain
from core.models import AuditMeta, Facility
from trip.models import Organisation, UserProfile
from yard.models import Alert, QueueEntry

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.skipif(
    os.environ.get('RUN_POSTGRES_LOAD') != '1', reason='Opt-in isolated PostgreSQL benchmark')]


@pytest.fixture(scope='session')
def django_db_modify_db_settings(django_db_modify_db_settings_parallel_suffix):
    from django.conf import settings
    database = settings.DATABASES['default']
    assert database['ENGINE'].endswith('postgresql'), 'PostgreSQL required'
    assert database['NAME'] == 'trucki_perf', 'Dedicated trucki_perf database required'
    database.setdefault('TEST', {})['NAME'] = 'test_trucki_perf'


def test_multitenant_reads_with_concurrent_commands(settings):
    settings.AUDIT_SALT = 'synthetic-postgres-load-only'
    from django.core.cache import cache
    cache.clear()
    sites, tokens = [], []
    for tenant in range(4):
        org = Organisation.objects.create(name=f'Synthetic load fleet {tenant}', slug=f'load-fleet-{tenant}')
        user = get_user_model().objects.create_user(username=f'load-tenant-{tenant}')
        profile = UserProfile.objects.create(user=user, organisation=org, role='OPERATIONS_SUPERVISOR')
        tokens.append(Token.objects.create(user=user).key)
        for site in range(2):
            facility = Facility.objects.create(organisation=org, name=f'Load yard {site}', slug=f'yard-{site}', yard_config={'mode': 'DEMO'})
            profile.facilities.add(facility)
            sites.append((tenant, facility))
            AuditMeta.objects.create(facility=facility)
            QueueEntry.objects.bulk_create([QueueEntry(organisation=org, facility=facility,
                reg_number=f'T{tenant}S{site}-{index}', status='QUEUED' if index < 300 else 'COMPLETED')
                for index in range(3000)])
            Alert.objects.bulk_create([Alert(organisation=org, facility=facility, severity='MEDIUM',
                message=f'Synthetic alert {index}', acknowledged=True, acknowledged_by=user) for index in range(100)])

    def client_for(tenant):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Token {tokens[tenant]}')
        return client

    for tenant, facility in sites:
        other = sites[((tenant+1) % 4)*2][1]
        assert client_for(tenant).get('/api/yard/board/', {'facility': other.pk}).status_code == 404

    runs = []
    for concurrency in (1, 4, 8):
        def request(index):
            tenant, facility = sites[index % len(sites)]
            client = client_for(tenant)
            started, sql_seconds, queries = time.perf_counter(), 0.0, 0
            command = index % 10 == 0
            def measure_sql(execute, sql, params, many, context):
                nonlocal sql_seconds, queries
                sql_started = time.perf_counter()
                try:
                    return execute(sql, params, many, context)
                finally:
                    sql_seconds += time.perf_counter()-sql_started
                    queries += 1
            try:
                with connection.execute_wrapper(measure_sql):
                    if command:
                        response = client.post('/api/queue/', {'facility': facility.pk,
                            'reg_number': f'WRITE-{tenant}-{concurrency}-{index}', 'idempotency_key': f'load-{concurrency}-{index}'}, format='json')
                    else:
                        response = client.get('/api/yard/board/', {'facility': facility.pk, 'scope': 'active', 'compact': '1'})
                valid = response.status_code == (201 if command else 200)
                if not command and valid:
                    valid = response.data['facility']['id'] == facility.pk and all(
                        row['reg_number'].startswith((f'T{tenant}S{index % 2}-', f'WRITE-{tenant}-')) for row in response.data['queue'])
                return {'latency_ms': (time.perf_counter()-started)*1000, 'status': response.status_code,
                    'valid': valid, 'command': command, 'sql_ms': sql_seconds*1000, 'queries': queries,
                    'bytes': len(response.content)}
            finally:
                connections.close_all()
        cpu_started, started = time.process_time(), time.perf_counter()
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            samples = list(pool.map(request, range(120)))
        elapsed = time.perf_counter()-started
        latencies = sorted(row['latency_ms'] for row in samples)
        runs.append({'concurrency': concurrency, 'requests': len(samples), 'commands': 12,
            'requests_per_second': round(len(samples)/elapsed, 2), 'median_ms': round(median(latencies), 2),
            'p95_ms': round(latencies[int((len(latencies)-1)*.95)], 2), 'p99_ms': round(latencies[int((len(latencies)-1)*.99)], 2),
            'process_cpu_s': round(time.process_time()-cpu_started, 3),
            'median_sql_ms': round(median(row['sql_ms'] for row in samples), 2),
            'median_read_queries': median(row['queries'] for row in samples if not row['command']),
            'errors': sum(not row['valid'] for row in samples)})
        assert all(row['valid'] for row in samples), samples
    for _, facility in sites:
        assert verify_chain(facility=facility)['ok']
    # Memory sampling is separate from throughput runs to avoid allocation
    # tracing overhead changing their latency measurements.
    tracemalloc.start()
    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            memory_samples = list(pool.map(request, range(1,9)))
        assert all(row['valid'] for row in memory_samples)
        _, peak_python_bytes = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    report = {'database': 'PostgreSQL 17, dedicated pytest test_trucki_perf',
        'dataset': {'tenants': 4, 'sites_per_tenant': 2, 'active_per_site': 300, 'history_per_site': 2700, 'alerts_per_site': 100},
        'transport': 'Django test client; real token auth, middleware, ORM, rendering, concurrent audited creates; no HTTP/TLS',
        'limits': 'Bounded workload within default throttles; CPU and Python allocations exclude the database process; no HTTP/TLS or production SLA claim',
        'separate_memory_sample': {'concurrency': 8, 'requests': 8, 'peak_traced_python_bytes': peak_python_bytes,
            'note': 'Python allocations during this sample; not total RSS or database memory'},
        'runs': runs}
    destination = Path(os.environ['POSTGRES_LOAD_REPORT'])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
