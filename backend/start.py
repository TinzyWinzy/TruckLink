"""Self-bootstrapping start script: runs migrations then execs gunicorn.

Idempotent: safe to run on every cold start.
- Runs `manage.py migrate` to bring the schema up to date.
- Demo bootstrap is explicitly opt-in; normal deployments never seed users.
- Re-execs into gunicorn so the PID is correct for Render's health check.
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.chdir(HERE)
sys.path.insert(0, str(HERE))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "spotter_backend.settings")

import django  # noqa: E402

django.setup()
from django.core.management import call_command  # noqa: E402

# A failed migration must prevent the new application from serving traffic.
call_command("migrate", interactive=False, verbosity=1)

if os.environ.get("ALLOW_DEMO_BOOTSTRAP", "").lower() in {"true", "1", "yes"}:
    call_command("seed_demo", verbosity=0)

cmd = [
    "gunicorn",
    "spotter_backend.wsgi:application",
    "--bind", f"0.0.0.0:{os.environ.get('PORT', '10000')}",
    "--workers", "2",
    "--timeout", "60",
]
os.execvp(cmd[0], cmd)
