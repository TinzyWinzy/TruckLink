"""Polling reads must preserve payloads without per-alert database queries."""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from tests.test_yard_api import _client_for
from yard.models import Alert, Dock, QueueEntry
from yard.serializers import AlertSerializer, DockSerializer, QueueEntrySerializer

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize('endpoint', ['/api/yard/board/', '/api/alerts/'])
def test_acknowledged_alert_queries_do_not_grow_with_rows(default_org, default_facility, endpoint):
    actor, client = _client_for('polling-ops', 'OPERATIONS_SUPERVISOR', default_org, default_facility)
    def add_alerts(count):
        Alert.objects.bulk_create([Alert(organisation=default_org, facility=default_facility,
            severity='MEDIUM', message='Synthetic read performance', acknowledged=True,
            acknowledged_by=actor) for _ in range(count)])
    add_alerts(1)
    with CaptureQueriesContext(connection) as first:
        response = client.get(endpoint, {'facility': default_facility.pk})
    assert response.status_code == 200
    add_alerts(29)
    with CaptureQueriesContext(connection) as loaded:
        response = client.get(endpoint, {'facility': default_facility.pk})
    assert response.status_code == 200
    assert len(loaded) <= len(first) + 1
    assert len(response.data['alerts']) == 30
    assert response.data['alerts'] == [AlertSerializer(a).data for a in
        Alert.objects.filter(facility=default_facility).select_related('acknowledged_by')]


def test_board_bulk_serialization_preserves_fields_counts_and_order(default_org, default_facility):
    _, client = _client_for('board-ops', 'OPERATIONS_SUPERVISOR', default_org, default_facility)
    dock = Dock.objects.create(organisation=default_org, facility=default_facility, name='Synthetic dock')
    for plate, status, assigned in [('READ-1', 'QUEUED', None), ('READ-2', 'AT_DOCK', dock)]:
        QueueEntry.objects.create(organisation=default_org, facility=default_facility,
            reg_number=plate, status=status, assigned_dock=assigned)
    data = client.get('/api/yard/board/', {'facility': default_facility.pk}).data
    assert data['counts'] == {'QUEUED': 1, 'AT_DOCK': 1}
    assert data['queue'] == [QueueEntrySerializer(e).data for e in
        QueueEntry.objects.filter(facility=default_facility).select_related('assigned_dock', 'journey_link')]
    assert data['docks'] == [DockSerializer(dock).data]
