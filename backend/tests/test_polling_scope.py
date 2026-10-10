"""Active polling must keep release-authorized trucks until their physical exit."""
import pytest
from django.utils import timezone
from tests.test_yard_api import _client_for
from yard.models import QueueEntry
from yard.serializers import PollQueueSerializer, poll_queue_rows
from tests.test_regulatory import domain, inspect

pytestmark = pytest.mark.django_db


def test_legacy_inspection_pass_stays_active_until_release(domain):
    from rest_framework.test import APIClient
    from yard.services import release_entry

    d = domain
    assert inspect(d).decision == 'PASS'
    client = APIClient()
    client.force_authenticate(d['inspector'])
    params = {'facility': d['default_facility'].pk, 'scope': 'active', 'compact': '1'}
    response = client.get('/api/yard/board/', params)
    assert [(row['id'], row['status']) for row in response.data['queue']] == [(d['entry'].pk, 'COMPLETED')]
    release_entry(d['entry'].pk, actor=d['inspector'])
    assert client.get('/api/yard/board/', params).data['queue'] == []


def test_demo_inspection_completion_stays_active_until_release(default_org, default_facility, settings):
    from yard.models import ComplianceCheck
    from compliance.policy import MANDATORY_CHECKLIST_IDS
    settings.AUDIT_SALT = 'synthetic-demo-poll-only'
    actor, client = _client_for('demo-release-poll', 'DISPATCH_SUPERVISOR', default_org, default_facility)
    entry = QueueEntry.objects.create(organisation=default_org, facility=default_facility,
        reg_number='DEMO-PASS', status='COMPLETED')
    ComplianceCheck.objects.create(organisation=default_org, facility=default_facility, queue_entry=entry,
        reg_number=entry.reg_number, inspector=actor, status='PASSED',
        checklist_results=dict.fromkeys(MANDATORY_CHECKLIST_IDS, True))
    params = {'facility': default_facility.pk, 'scope': 'active', 'compact': '1'}
    assert client.get('/api/yard/board/', params).data['queue'][0]['id'] == entry.pk
    assert client.post(f'/api/queue/{entry.pk}/release/').status_code == 200
    assert client.get('/api/yard/board/', params).data['queue'] == []


def test_poll_projection_matches_serializer_with_link_nulls_and_timestamps(domain):
    from journeys.models import JourneyLink
    from yard.models import Dock
    from django.test.utils import CaptureQueriesContext
    from django.db import connection
    from django.utils import timezone

    d = domain
    entry = d['entry']
    dock = Dock.objects.create(organisation=d['org'], facility=d['default_facility'], name='Projection dock')
    entry.assigned_dock = dock
    entry.release_authorized_at = timezone.now()
    entry.dock_vacated_at = timezone.now()
    entry.dwell_duration_seconds = 125
    entry.save()
    JourneyLink.objects.create(organisation=d['org'], facility=d['default_facility'], visit=entry,
        trip=d['trip'], assignment={'synthetic': True}, reason='Synthetic read projection')
    entries = QueueEntry.objects.filter(facility=d['default_facility']).select_related('journey_link', 'assigned_dock')
    with timezone.override('Africa/Johannesburg'):
        expected = PollQueueSerializer(entries, many=True).data
        with CaptureQueriesContext(connection) as queries:
            actual = poll_queue_rows(entries)
    assert actual == expected
    assert actual[0]['assigned_dock'] == dock.pk
    assert actual[0]['journey_trip_id'] == d['trip'].pk
    assert actual[0]['exit_timestamp'] is None
    assert len(queries) == 1


def test_compact_active_board_excludes_history_but_preserves_awaiting_exit(default_org, default_facility):
    _, client = _client_for('scope-ops', 'OPERATIONS_SUPERVISOR', default_org, default_facility)
    entries = []
    for plate, fields in [('queued', {'status': 'QUEUED'}),
        ('legacy-closed', {'status': 'RELEASED'}),
        ('awaiting-exit', {'status': 'RELEASED', 'milestone_semantics': 'SEPARATE_V1'}),
        ('physically-exited', {'status': 'RELEASED', 'milestone_semantics': 'SEPARATE_V1', 'exit_timestamp': timezone.now()})]:
        entries.append(QueueEntry.objects.create(organisation=default_org, facility=default_facility, reg_number=plate, **fields))
    path = '/api/yard/board/'
    full = client.get(path, {'facility': default_facility.pk})
    response = client.get(path, {'facility': default_facility.pk, 'scope': 'active', 'compact': '1'})
    assert response.status_code == 200 and len(full.data['queue']) == 4
    assert [row['reg_number'] for row in response.data['queue']] == ['queued', 'awaiting-exit']
    assert response.data['counts'] == {'QUEUED': 1, 'RELEASED': 1}
    assert response.data['queue'] == PollQueueSerializer([entries[0], entries[2]], many=True).data
    assert response['Cache-Control'] == 'private, no-store'
    assert all('idempotency_key' not in row and 'created_at' not in row for row in response.data['queue'])


def test_history_is_bounded_paginated_and_disjoint_from_active(default_org, default_facility):
    _, client = _client_for('history-ops', 'OPERATIONS_SUPERVISOR', default_org, default_facility)
    QueueEntry.objects.bulk_create([QueueEntry(organisation=default_org, facility=default_facility,
        reg_number=f'HISTORY-{i}', status='COMPLETED') for i in range(205)])
    active = QueueEntry.objects.create(organisation=default_org, facility=default_facility, reg_number='ACTIVE')
    params = {'facility': default_facility.pk, 'scope': 'history'}
    first = client.get('/api/queue/', params).data
    second = client.get('/api/queue/', {**params, 'offset': first['next_offset']}).data
    last = client.get('/api/queue/', {**params, 'offset': second['next_offset']}).data
    rows = first['queue'] + second['queue'] + last['queue']
    assert [first['count'], second['count'], last['count']] == [100, 100, 5]
    assert first['total'] == 205 and last['next_offset'] is None
    assert len({row['id'] for row in rows}) == 205
    assert active.pk not in {row['id'] for row in rows}
    assert len(client.get('/api/queue/', {'facility': default_facility.pk}).data['queue']) == 206


@pytest.mark.parametrize('path,params', [
    ('/api/yard/board/', {'scope': 'foreign'}), ('/api/yard/board/', {'compact': '2'}),
    ('/api/queue/', {'limit': '0'}), ('/api/queue/', {'limit': '201'}),
    ('/api/queue/', {'limit': 'bad'}), ('/api/queue/', {'offset': '-1'}),
    ('/api/queue/', {'offset': '1'}), ('/api/queue/', {'scope': 'bad'})])
def test_invalid_scope_or_page_is_rejected(default_org, default_facility, path, params):
    _, client = _client_for('invalid-poll-ops', 'OPERATIONS_SUPERVISOR', default_org, default_facility)
    assert client.get(path, {'facility': default_facility.pk, **params}).status_code == 400
