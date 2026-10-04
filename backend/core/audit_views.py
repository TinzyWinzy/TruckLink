"""Audit endpoints (SAD v2 §11): list, verify, CSV export.

Class-based so `rbac_resource` is a real view attribute for RoleAccess.
Facility is required and must belong to the caller (404 otherwise — no
existence oracle across tenants).
"""
from __future__ import annotations

import csv
import io

from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.audit import verify_chain
from core.models import Facility
from core.rbac import RoleAccess
from trip.permissions import in_facility
from yard.models import AuditLog


def resolve_facility(request):
    facility_ref = request.query_params.get("facility")
    if not facility_ref:
        return None, Response(
            {"ok": False, "error": "facility query param required"},
            status=400,
        )
    facility = find_facility(facility_ref, request.user)
    if facility is None:
        return None, Response({"ok": False, "error": "not found"}, status=404)
    return facility, None


def find_facility(ref, user):
    """Resolve a facility by pk OR slug (VITE_FACILITY_ID may be either);
    must belong to the caller — 404, never an existence oracle. Slugs are
    unique per organisation only, so slug matches are scanned for membership."""
    qs = Facility.objects.filter(is_deleted=False)
    try:
        facility = qs.filter(pk=ref).first()
    except (TypeError, ValueError):
        facility = None
    if facility is not None:
        return facility if in_facility(user, facility) else None
    for candidate in qs.filter(slug=ref):
        if in_facility(user, candidate):
            return candidate
    return None


class AuditListView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "audit"
    rbac_action = "read"

    def get(self, request):
        facility, err = resolve_facility(request)
        if err is not None:
            return err
        rows = AuditLog.objects.filter(facility=facility).select_related("actor")
        entries = [
            {
                "id": str(r.id),
                "action": r.action,
                "payload": r.payload,
                "actor": r.actor.username if r.actor else None,
                "actor_ref": r.actor_ref,
                "timestamp": r.timestamp.isoformat(),
                "previous_hash": r.previous_hash,
                "hash": r.hash,
            }
            for r in rows
        ]
        return Response({"ok": True, "count": len(entries), "entries": entries})


class AuditVerifyView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "audit"
    rbac_action = "read"

    def get(self, request):
        facility, err = resolve_facility(request)
        if err is not None:
            return err
        result = verify_chain(facility)
        return Response({"ok": result["ok"], **result}, status=200 if result["ok"] else 409)


class AuditExportView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "audit"
    rbac_action = "read"

    def get(self, request):
        facility, err = resolve_facility(request)
        if err is not None:
            return err
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["id", "action", "payload", "actor", "actor_ref",
                         "timestamp", "previous_hash", "hash"])
        for r in AuditLog.objects.filter(facility=facility).select_related("actor"):
            writer.writerow([
                str(r.id), r.action, r.payload,
                r.actor.username if r.actor else "", r.actor_ref,
                r.timestamp.isoformat(), r.previous_hash, r.hash,
            ])
        resp = HttpResponse(buf.getvalue(), content_type="text/csv")
        resp["Content-Disposition"] = f'attachment; filename="audit-{facility.slug}.csv"'
        return resp
