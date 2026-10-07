"""Dashboard counts must remain scoped and preserve milestone meaning."""
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import Facility
from trip.models import Organisation
from yard.models import Alert, Dock, QueueEntry
from tests.test_reports_admin import _client_for

pytestmark = pytest.mark.django_db
URL = '/api/reports/dashboard/'


@pytest.fixture
def dashboard(default_org, default_facility):
    user, client = _client_for('dashboard-executive', 'EXECUTIVE', default_org, default_facility)
    return default_org, default_facility, user, client


def test_empty_is_zero_with_unknown_duration_and_bounded_bins(dashboard):
    _, site, _, client = dashboard
    response = client.get(URL, {'facility': site.pk})
    assert response.status_code == 200
    data = response.data
    assert len(data['series']) == 25
    assert data['summary'] == {'active': 0, 'blocked': 0, 'arrivals': 0, 'physical_exits': 0, 'mean_turnaround_minutes': None}
    assert data['docks'] == {} and data['alerts'] == {}
    assert response['Cache-Control'] == 'private, no-store'


def test_recorded_exit_separate_from_release_and_old_active_not_truncated(dashboard):
    org, site, _, client = dashboard
    now = timezone.now().replace(minute=30, second=0, microsecond=0)
    def create(plate, **values):
        return QueueEntry.objects.create(organisation=org, facility=site, reg_number=plate, **values)
    create('physical', entry_timestamp=now-timedelta(hours=3), exit_timestamp=now-timedelta(hours=1), milestone_semantics='SEPARATE_V1', status='RELEASED')
    create('released-only', entry_timestamp=now-timedelta(hours=2), milestone_semantics='SEPARATE_V1', status='RELEASED')
    create('legacy', entry_timestamp=now-timedelta(hours=3), exit_timestamp=now-timedelta(hours=1), status='RELEASED')
    create('very-old-active', entry_timestamp=now-timedelta(days=45), status='QUARANTINED')
    create('invalid', entry_timestamp=now-timedelta(hours=1), exit_timestamp=now-timedelta(hours=2), milestone_semantics='SEPARATE_V1', status='RELEASED')
    create('future', entry_timestamp=now+timedelta(hours=1))
    for n in range(110):
        create(f'closed-{n}', entry_timestamp=now-timedelta(hours=4), exit_timestamp=now-timedelta(hours=3), status='COMPLETED')
    Dock.objects.create(organisation=org, facility=site, name='Dock 1', status='OCCUPIED')
    Alert.objects.create(organisation=org, facility=site, severity='CRITICAL', category='TEST', message='Synthetic')
    with patch('yard.dashboard.timezone.now', return_value=now):
        data = client.get(URL, {'facility': site.pk}).data
    assert data['summary']['active'] == 2 and data['summary']['blocked'] == 1
    assert data['summary']['physical_exits'] == 1 and data['summary']['mean_turnaround_minutes'] == 120
    assert sum(r['exits'] for r in data['series']) == 1
    assert data['active_statuses'] == {'QUARANTINED': 1, 'RELEASED': 1}
    assert data['age_buckets'][-1]['count'] == 2
    assert data['coverage']['legacy_completions_excluded'] == 111
    assert data['coverage']['future_arrivals_excluded'] == 1 and data['coverage']['invalid_exit_timestamps'] == 1
    assert data['docks'] == {'OCCUPIED': 1} and data['alerts'] == {'CRITICAL': 1}


def test_foreign_tenant_and_unassigned_site_are_not_exposed(dashboard):
    org, site, _, client = dashboard
    foreign_org = Organisation.objects.create(name='Other synthetic tenant')
    foreign = Facility.objects.create(organisation=foreign_org, name='Other site', slug='other-dashboard')
    unassigned = Facility.objects.create(organisation=org, name='Unassigned', slug='unassigned-dashboard')
    for target in (foreign, unassigned):
        QueueEntry.objects.create(organisation=target.organisation, facility=target, reg_number='SECRET', status='QUARANTINED')
        assert client.get(URL, {'facility': target.pk}).status_code == 404
    assert client.get(URL, {'facility': site.pk}).data['summary']['active'] == 0


def test_unauthenticated_and_restricted_roles_are_denied(dashboard):
    org, site, _, _ = dashboard
    assert APIClient().get(URL, {'facility': site.pk}).status_code == 401
    _, dispatcher = _client_for('dashboard-dispatcher', 'DISPATCH_SUPERVISOR', org, site)
    assert dispatcher.get(URL, {'facility': site.pk}).status_code == 403


@pytest.mark.parametrize('window,bins', [('7d', 8), ('30d', 31)])
def test_daily_bins_follow_site_timezone_and_window(dashboard, window, bins):
    org, site, _, client = dashboard
    site.timezone = 'Africa/Johannesburg'
    site.save(update_fields=['timezone'])
    now = timezone.now().replace(hour=23, minute=30, second=0, microsecond=0)
    QueueEntry.objects.create(organisation=org, facility=site, reg_number='midnight', entry_timestamp=now)
    with patch('yard.dashboard.timezone.now', return_value=now):
        data = client.get(URL, {'facility': site.pk, 'window': window}).data
    assert len(data['series']) == bins
    assert data['series'][-1]['arrivals'] == 1
    assert data['series'][-1]['at'].endswith('T00:00:00+02:00')


def test_invalid_window_rejected(dashboard):
    _, site, _, client = dashboard
    assert client.get(URL, {'facility': site.pk, 'window': '365d'}).status_code == 400


def test_hourly_buckets_distinguish_daylight_saving_fold(dashboard):
    org, site, _, client = dashboard
    site.timezone = 'America/New_York'
    site.save(update_fields=['timezone'])
    now = datetime(2026, 11, 1, 8, 30, tzinfo=dt_timezone.utc)
    for hour in (5, 6):  # Both are 01:30 local, on opposite sides of the DST fold.
        QueueEntry.objects.create(organisation=org, facility=site, reg_number=f'fold-{hour}',
            entry_timestamp=now.replace(hour=hour))
    with patch('yard.dashboard.timezone.now', return_value=now):
        data = client.get(URL, {'facility': site.pk}).data
    assert len(data['series']) == 25 and data['summary']['arrivals'] == 2
    assert len([p for p in data['series'] if p['arrivals'] == 1]) == 2
