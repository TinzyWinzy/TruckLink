"""Audit chain (SAD v2 §6) — port of server/src/audit/append.ts.

Semantics preserved byte-for-byte:
  hash = sha256(previous_hash + payload + salt)
  - fail-closed: missing AUDIT_SALT refuses to append
  - per-facility AuditMeta row is the lock (SELECT ... FOR UPDATE)
  - replay of an existing entry id is a no-op (meta does not advance)
"""
from __future__ import annotations

import hashlib
import json
import uuid

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from core.models import AuditMeta, Facility
from yard.models import AuditLog


class AuditSaltMissing(RuntimeError):
    """AUDIT_SALT unset — refusing to append to the audit chain (fail-closed)."""


def require_salt() -> str:
    salt = getattr(settings, "AUDIT_SALT", "") or ""
    if not salt:
        raise AuditSaltMissing(
            "AUDIT_SALT unset — refusing to append to the audit chain (fail-closed)."
        )
    return salt


def hash_audit_entry(previous_hash: str, payload: str, salt: str) -> str:
    return hashlib.sha256(f"{previous_hash}{payload}{salt}".encode("utf-8")).hexdigest()


def _payload_str(payload) -> str:
    if isinstance(payload, str):
        return payload
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def append_audit(
    *,
    facility: Facility,
    action: str,
    payload,
    actor=None,
    actor_ref: str = "",
    timestamp=None,
    entry_id=None,
):
    """Append one entry to the facility chain inside the caller's transaction.

    Returns the created AuditLog row, or None if this entry id already
    existed (replay no-op — meta must not advance).
    """
    salt = require_salt()  # before any write: fail-closed
    payload_str = _payload_str(payload)
    entry_id = entry_id or uuid.uuid4()
    ts = timestamp or timezone.now()

    with transaction.atomic():
        AuditMeta.objects.get_or_create(facility=facility)
        meta = AuditMeta.objects.select_for_update().get(facility=facility)
        if AuditLog.objects.filter(pk=entry_id).exists():
            return None
        previous = meta.current_hash
        digest = hash_audit_entry(previous, payload_str, salt)
        row = AuditLog.objects.create(
            id=entry_id,
            organisation=facility.organisation,
            facility=facility,
            action=action,
            payload=payload_str,
            actor=actor,
            actor_ref=actor_ref,
            timestamp=ts,
            previous_hash=previous,
            hash=digest,
        )
        meta.current_hash = digest
        meta.seq += 1
        meta.save(update_fields=["current_hash", "seq", "updated_at"])
        if isinstance(payload,dict):
            from tenancy.execution import record_audit
            record_audit(row,payload)
        return row


def verify_chain(facility: Facility) -> dict:
    """Walk every row of the facility chain; detect tampering, forks, gaps.

    Checks per row: sha256(previous_hash + payload + salt) == hash.
    Structural checks: exactly one GENESIS head, every hash referenced once,
    single walkable chain covering all rows, meta matches the tip.
    """
    salt = require_salt()
    rows = list(
        AuditLog.objects.filter(facility=facility).order_by("timestamp", "hash")
    )
    issues: list[str] = []
    if not rows:
        meta = AuditMeta.objects.filter(facility=facility).first()
        ok = meta is None or (meta.current_hash == "GENESIS" and meta.seq == 0)
        return {"ok": ok, "count": 0, "seq": 0 if meta is None else meta.seq,
                "issues": [] if ok else ["meta not at genesis for empty chain"]}

    by_hash: dict[str, AuditLog] = {}
    for row in rows:
        expected = hash_audit_entry(row.previous_hash, row.payload, salt)
        if expected != row.hash:
            issues.append(f"tampered: {row.action}@{row.id}")
        if row.hash in by_hash:
            issues.append(f"duplicate hash: {row.hash}")
        by_hash[row.hash] = row

    heads = [r for r in rows if r.previous_hash == "GENESIS"]
    if len(heads) != 1:
        issues.append(f"expected exactly 1 genesis head, found {len(heads)}")
        return {"ok": False, "count": len(rows), "seq": -1, "issues": issues}

    by_previous: dict[str, AuditLog] = {}
    for row in rows:
        if row.previous_hash == "GENESIS":
            continue
        if row.previous_hash not in by_hash:
            issues.append(f"broken link: {row.action}@{row.id}")
            continue
        if row.previous_hash in by_previous:
            issues.append(f"fork at {row.previous_hash}")
            continue
        by_previous[row.previous_hash] = row

    visited: set = set()
    cursor = heads[0]
    while True:
        if cursor.id in visited:
            issues.append("cycle detected")
            break
        visited.add(cursor.id)
        nxt = by_previous.get(cursor.hash)
        if nxt is None:
            break
        cursor = nxt
    if len(visited) != len(rows):
        issues.append(f"disconnected rows: {len(rows) - len(visited)}")

    meta = AuditMeta.objects.filter(facility=facility).first()
    if meta is None:
        issues.append("audit_meta missing")
        seq = -1
    else:
        seq = meta.seq
        if meta.current_hash != cursor.hash:
            issues.append("meta.current_hash does not match chain tip")
        if meta.seq != len(rows):
            issues.append(f"meta.seq {meta.seq} != row count {len(rows)}")

    return {"ok": not issues, "count": len(rows), "seq": seq, "issues": issues}
