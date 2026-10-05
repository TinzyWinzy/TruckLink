"""Deployment must fail closed on schema errors and avoid implicit demo users."""
import runpy
from pathlib import Path
from unittest.mock import Mock

import pytest


def execute_start(monkeypatch, migrate_error=None, demo=False):
    import django
    import django.core.management
    import os
    import sys

    monkeypatch.setattr(django, 'setup', Mock())
    calls = []

    def command(name, **kwargs):
        calls.append(name)
        if name == 'migrate' and migrate_error:
            raise migrate_error

    monkeypatch.setattr(django.core.management, 'call_command', command)
    launch = Mock()
    monkeypatch.setattr(os, 'execvp', launch)
    monkeypatch.setattr(os, 'chdir', Mock())
    monkeypatch.setattr(sys, 'path', list(sys.path))
    monkeypatch.setenv('ALLOW_DEMO_BOOTSTRAP', 'true' if demo else 'false')
    runpy.run_path(str(Path(__file__).resolve().parents[1] / 'start.py'))
    return calls, launch


def test_startup_migrates_without_seeding(monkeypatch):
    calls, launch = execute_start(monkeypatch)
    assert calls == ['migrate']
    launch.assert_called_once()


def test_failed_migration_aborts_startup(monkeypatch):
    with pytest.raises(RuntimeError, match='schema reconciliation required'):
        execute_start(monkeypatch, RuntimeError('schema reconciliation required'))


def test_demo_bootstrap_requires_explicit_opt_in(monkeypatch):
    calls, launch = execute_start(monkeypatch, demo=True)
    assert calls == ['migrate', 'seed_demo']
    launch.assert_called_once()
