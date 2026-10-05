"""Real browser/API journeys; synthetic policy, disposable Django test DB only."""
import json
import os
from pathlib import Path
import subprocess

import pytest

from tests.test_regulatory import domain  # reuse independently reviewed synthetic fixture
from regulatory import models as m, services as s
from yard.models import QueueEntry

pytestmark = [pytest.mark.browser_flow, pytest.mark.django_db(transaction=True),
    pytest.mark.skipif(os.environ.get('RUN_STORY_BROWSER') != '1', reason='Opt in with RUN_STORY_BROWSER=1')]


@pytest.fixture(scope='session')
def django_db_modify_db_settings(django_db_modify_db_settings_parallel_suffix, tmp_path_factory):
    from django.conf import settings
    if settings.DATABASES['default']['ENGINE'].endswith('sqlite3'):
        # live_server threads must not share Django's in-memory SQLite connection.
        settings.DATABASES['default'].setdefault('TEST', {})['NAME'] = str(
            tmp_path_factory.mktemp('story-db') / 'isolated.sqlite3')


def test_user_story_browser_journeys(domain, live_server, settings):
    d = domain
    settings.CORS_ALLOW_ALL_ORIGINS = True
    actors = {'inspector': d['inspector'], 'requester': d['ops'], 'approver': d['ops2']}
    for actor in actors.values():
        actor.set_password('synthetic-flow-only-123')
        actor.save()
    entries = {}
    for name in ['clean', 'remediation', 'exception', 'missing']:
        entry = QueueEntry.objects.create(organisation=d['org'], facility=d['default_facility'],
            reg_number=d['vehicle'].plate, status='AT_DOCK')
        s.create_context(d['inspector'], entry, configuration=d['config'], driver=d['driver'],
            trip=d['trip'], load=d['load'], route_type='DOMESTIC' if name != 'missing' else 'CROSS_BORDER',
            jurisdictions=['TEST'] if name != 'missing' else ['TEST', 'UNCONFIGURED'],
            origin=d['trip'].origin, destination=d['trip'].destination, evidence_ids=[])
        entries[name] = entry.pk
    env = {**os.environ, 'STORY_API_URL': live_server.url,
           'STORY_FACILITY': d['default_facility'].slug,
           'STORY_ENTRIES': json.dumps(entries),
           'STORY_ACTORS': json.dumps({name: actor.username for name, actor in actors.items()})}
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(['npm.cmd' if os.name == 'nt' else 'npm', 'run', 'test:e2e', '--',
        '--config', 'playwright.stories.config.ts', '--max-failures=1'], cwd=root / 'web', env=env,
        capture_output=True, text=True, timeout=360)
    assert result.returncode == 0, result.stdout + result.stderr
    for name in ['clean', 'remediation', 'exception']:
        assert QueueEntry.objects.get(pk=entries[name]).status == 'RELEASED'
        assert m.ReleaseRecord.objects.filter(queue_entry_id=entries[name]).exists()
    assert not m.ReleaseRecord.objects.filter(queue_entry_id=entries['missing']).exists()
    assert m.InspectionAttempt.objects.filter(queue_entry_id=entries['remediation']).count() == 2
    original = m.InspectionAttempt.objects.get(queue_entry_id=entries['exception'])
    assert original.decision == 'QUARANTINE'
