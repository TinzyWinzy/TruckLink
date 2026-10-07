"""Turnaround report math (SAD v2 section 11) - port of live.ts.

Ports computeTurnaroundStats(): pure over queue rows, unit-tested.
  - observed exits: turnaround = exit - entry (legacy fallback retained)
  - new release authorisations/inspection completion: still waiting until gate exit
  - waiting rows: wait = now - entry; overdue when wait > threshold (60 min)
"""
from __future__ import annotations

from datetime import timedelta

DEFAULT_OVERDUE_MINUTES = 60


def compute_turnaround_stats(rows, now, overdue_minutes=DEFAULT_OVERDUE_MINUTES) -> dict:
    by_status: dict[str, int] = {}
    waits: list[float] = []
    turns: list[float] = []
    overdue_count = 0

    for row in rows:
        status = str(getattr(row, "status", None) or "UNKNOWN")
        by_status[status] = by_status.get(status, 0) + 1

        entered = getattr(row, "entry_timestamp", None) or getattr(row, "created_at", None)
        exited = getattr(row, "exit_timestamp", None)
        if exited is None and getattr(row, 'milestone_semantics', 'LEGACY_COMBINED') != 'SEPARATE_V1' and status in ("RELEASED", "COMPLETED"):
            exited = getattr(row, "updated_at", None)
        if entered is None:
            continue
        end = exited if exited is not None else now
        if end < entered:
            continue
        minutes = (end - entered).total_seconds() / 60.0
        if exited is not None:
            turns.append(minutes)
        else:
            waits.append(minutes)
            if minutes > overdue_minutes:
                overdue_count += 1

    def avg(values):
        return None if not values else sum(values) / len(values)

    return {
        "total": len(rows),
        "byStatus": by_status,
        "avgWaitMinutes": avg(waits),
        "avgTurnaroundMinutes": avg(turns),
        "overdueCount": overdue_count,
    }


def parse_range(query_params) -> tuple:
    """Parse optional from/to ISO params -> (start, end, error)."""
    from datetime import datetime, timezone as dt_timezone

    start = end = None
    for key in ("from", "to"):
        raw = query_params.get(key)
        if not raw:
            continue
        try:
            stamp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None, None, f"invalid {key} datetime"
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=dt_timezone.utc)
        elif key == "to" and len(raw) == 10:
            stamp = stamp.replace(tzinfo=dt_timezone.utc)
        if key == "from":
            start = stamp
        else:
            if len(raw) == 10:  # date-only: inclusive end of day
                stamp = stamp + timedelta(days=1) - timedelta(microseconds=1)
            end = stamp
    return start, end, None
