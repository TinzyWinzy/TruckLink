"""Drain the transactional outbox (SAD §10): manage.py notify."""
from __future__ import annotations

from django.core.management.base import BaseCommand

from core import notify


class Command(BaseCommand):
    help = (
        "Dispatch pending OutboxEvent rows (WhatsApp -> SMS fallback -> web "
        "push, per-leg NotificationLog) and record escalation timers."
    )

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=50)
        parser.add_argument("--facility", type=str, default="")

    def handle(self, *args, **options):
        result = notify.run(limit=options["limit"], facility_ref=options["facility"])
        self.stdout.write(
            self.style.SUCCESS(
                f"dispatched={result['done']} failed={result['failed']} "
                f"escalations={result['escalations']}"
            )
        )
