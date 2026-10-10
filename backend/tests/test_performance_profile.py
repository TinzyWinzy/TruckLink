"""Opt-in CPU/payload profiling against a disposable synthetic test database."""
import cProfile
import gzip
import json
import os
import pstats
import time
from unittest.mock import patch
from pathlib import Path
from statistics import median

import pytest
from django.db import connection
from tests.test_load_benchmark import django_db_modify_db_settings  # noqa: F401
from tests.test_yard_api import _client_for
from yard.models import Alert, QueueEntry
from regulatory.modelling import run_model
from yard.serializers import PollQueueSerializer, poll_queue_rows

pytestmark = [pytest.mark.django_db(transaction=True), pytest.mark.skipif(
    os.environ.get('RUN_PERFORMANCE_PROFILE') != '1', reason='Opt-in CPU profiling')]


def profile(function, repeats):
    function()
    profiler = cProfile.Profile()
    started = time.process_time()
    profiler.enable()
    for _ in range(repeats):
        function()
    profiler.disable()
    elapsed = time.process_time()-started
    stats = pstats.Stats(profiler)
    rows = [{'file': Path(file).name, 'function': name, 'line': line, 'calls': calls,
             'self_s': round(own, 6), 'cumulative_s': round(cumulative, 6)}
            for (file, line, name), (_, calls, own, cumulative, _) in stats.stats.items()]
    rows.sort(key=lambda row: row['cumulative_s'], reverse=True)
    return {'repeats': repeats, 'process_cpu_s': round(elapsed, 6),
            'function_timer': 'cProfile default elapsed timer; cumulative times include database waits and profiling overhead',
            'top_cumulative': rows[:30],
            'top_self': sorted(rows, key=lambda row: row['self_s'], reverse=True)[:20]}


def test_payload_and_cpu_profile(default_org, default_facility):
    actor, client = _client_for('profile-ops', 'OPERATIONS_SUPERVISOR', default_org, default_facility)
    QueueEntry.objects.bulk_create([QueueEntry(organisation=default_org, facility=default_facility,
        reg_number=f'PROFILE-{i:04}', status='QUEUED' if i < 300 else 'COMPLETED') for i in range(3000)])
    Alert.objects.bulk_create([Alert(organisation=default_org, facility=default_facility,
        severity='MEDIUM', message=f'Synthetic profile alert {i}', acknowledged=True,
        acknowledged_by=actor) for i in range(100)])
    common = f'/api/yard/board/?facility={default_facility.pk}'
    measurements = {}
    for label, path in [('legacy_full', common), ('active_compact', common+'&scope=active&compact=1')]:
        response = client.get(path)
        assert response.status_code == 200
        assert len(response.data['queue']) == (3000 if label == 'legacy_full' else 300)
        query_count = 0
        def count_query(execute, sql, params, many, context):
            nonlocal query_count
            query_count += 1
            return execute(sql, params, many, context)
        def read():
            result = client.get(path)
            assert result.status_code == 200, result.content
            return result
        with connection.execute_wrapper(count_query):
            read()
        times = []
        for _ in range(8):
            started = time.perf_counter(); read()
            times.append((time.perf_counter()-started)*1000)
        compressors = {}
        for level in (1, 6):
            compressed = gzip.compress(response.content, compresslevel=level, mtime=0)
            started = time.perf_counter()
            for _ in range(20):
                gzip.compress(response.content, compresslevel=level, mtime=0)
            compressors[f'gzip_{level}'] = {'bytes': len(compressed),
                'mean_compression_ms': round((time.perf_counter()-started)*1000/20, 3)}
        measurements[label] = {'bytes': len(response.content), 'queries': query_count,
            'median_ms': round(median(times), 3), 'gzip': compressors,
            'cpu': profile(read, 8)}
    # Alternate both implementations against the same fixture, auth, active
    # predicate and renderer. Require byte-for-byte output before timing.
    compact_path = common+'&scope=active&compact=1'
    projection_bytes = client.get(compact_path).content
    with patch('yard.views.poll_queue_rows', lambda entries: PollQueueSerializer(entries, many=True).data):
        serializer_bytes = client.get(compact_path).content
    assert projection_bytes == serializer_bytes
    paired = {'serializer_ms': [], 'projection_ms': []}
    for iteration in range(20):
        order = ['serializer_ms', 'projection_ms'] if iteration % 2 else ['projection_ms', 'serializer_ms']
        for label in order:
            implementation = poll_queue_rows if label == 'projection_ms' else lambda entries: PollQueueSerializer(entries, many=True).data
            with patch('yard.views.poll_queue_rows', implementation):
                started = time.perf_counter()
                response = client.get(compact_path)
                assert response.status_code == 200 and response.content == projection_bytes
                paired[label].append((time.perf_counter()-started)*1000)
    paired = {label: round(median(times), 3) for label, times in paired.items()}
    paired['speedup'] = round(paired['serializer_ms']/paired['projection_ms'], 3)
    report = {'dataset': {'active_visits': 300, 'closed_visits': 2700, 'acknowledged_alerts': 100},
        'environment': 'Local Python 3.14, file SQLite, Django test client; no transport or production capacity claim',
        'board': measurements,
        'paired_read_projection': paired,
        'modelling': {'vehicles': 5000, 'cpu': profile(lambda: run_model(vehicles=5000), 10)}}
    destination = Path(os.environ['PROFILE_REPORT'])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({label: {key: value for key, value in data.items() if key != 'cpu'}
                      for label, data in measurements.items()}, indent=2))
