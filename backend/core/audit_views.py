"""Audit endpoints (SAD v2 §11): list, verify, CSV export.

Class-based so `rbac_resource` is a real view attribute for RoleAccess.
Facility is required and must belong to the caller (404 otherwise — no
existence oracle across tenants).
"""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime,time,timedelta
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from django.db.models import Q
from django.utils.dateparse import parse_date

from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.audit import verify_chain
from core.models import Facility
from core.rbac import RoleAccess
from trip.permissions import in_facility
from yard.models import AuditLog


def filtered_rows(request,facility):
    rows=AuditLog.objects.filter(facility=facility,organisation=facility.organisation).select_related('actor')
    try: tz=ZoneInfo(facility.timezone)
    except ZoneInfoNotFoundError: tz=ZoneInfo('UTC')
    for key,lookup in (('from','timestamp__gte'),('to','timestamp__lt')):
        value=request.query_params.get(key)
        if value:
            day=parse_date(value)
            if day is None:raise ValueError('Dates must use YYYY-MM-DD')
            if key=='to':day+=timedelta(days=1)
            rows=rows.filter(**{lookup:datetime.combine(day,time.min,tzinfo=tz)})
    if request.query_params.get('action'):rows=rows.filter(action=request.query_params['action'])
    if request.query_params.get('q'):
        q=request.query_params['q'][:200]
        rows=rows.filter(Q(payload__icontains=q)|Q(actor__username__icontains=q)|Q(action__icontains=q)|Q(actor_ref__icontains=q))
    return rows.order_by('-timestamp','-pk')


def audit_entry(row,facility):
    try:payload=json.loads(row.payload)
    except (ValueError,TypeError):payload={}
    if not isinstance(payload,dict):payload={}
    # References and states are sourced from retained payloads, never reconstructed from today's records.
    return {'id':str(row.pk),'action':row.action,'payload':row.payload,
        'actor':row.actor.username if row.actor else None,'actor_ref':row.actor_ref,
        'timestamp':row.timestamp.isoformat(),'timezone':facility.timezone,
        'previous_hash':row.previous_hash,'hash':row.hash,
        'references':{'visit':payload.get('queue_entry_id',payload.get('queueEntryId')),
            'trip':payload.get('trip_id'),'vehicle':payload.get('reg_number',payload.get('licensePlate')),
            'consignment':payload.get('consignment_id'),'order_reference':payload.get('consignment_reference',payload.get('reference') if row.action=='CREATE_CONSIGNMENT' else None)},
        'reason':payload.get('reason',payload.get('notes')),
        'previous_state':payload.get('previous_state',payload.get('from_status')),
        'new_state':payload.get('new_state',payload.get('to_status',payload.get('status')))}


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
        try:
            rows=filtered_rows(request,facility)
            limit=min(500,max(1,int(request.query_params.get('limit',100))))
            offset=max(0,int(request.query_params.get('offset',0)))
        except ValueError as exc:return Response({'error':str(exc)},status=400)
        count=rows.count()
        entries=[audit_entry(r,facility) for r in rows[offset:offset+limit]]
        return Response({'ok':True,'count':count,'entries':entries,'offset':offset,'limit':limit,
            'timezone':facility.timezone,'has_more':offset+limit<count})


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
        try:rows=filtered_rows(request,facility)
        except ValueError as exc:return Response({'error':str(exc)},status=400)
        for r in rows:
            writer.writerow([
                str(r.id), r.action, r.payload,
                r.actor.username if r.actor else "", r.actor_ref,
                r.timestamp.isoformat(), r.previous_hash, r.hash,
            ])
        resp = HttpResponse(buf.getvalue(), content_type="text/csv")
        resp["Content-Disposition"] = f'attachment; filename="audit-{facility.slug}.csv"'
        return resp
