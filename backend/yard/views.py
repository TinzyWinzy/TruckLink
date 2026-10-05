"""Yard endpoints (SAD v2 section 11): board digest, queue, docks, alerts,
reports and the admin demo seed/reset.

Ports of bak-logistics-app/src/lib/powersync/operations.ts:
  registerVehiclePS / assignDockPS / releaseVehiclePS / acknowledgeAlertPS.
Release gate (section 9): only COMPLETED or OVERRIDE_APPROVED may be released;
the gate is engine.can_transition(status, "RELEASED") - one FSM, one truth.
"""
from __future__ import annotations

import csv
import io

from django.db import IntegrityError, transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from compliance import engine
from core.audit import append_audit
from core.audit_views import find_facility, resolve_facility
from core.models import OutboxEvent
from core.rbac import RoleAccess
from trip.permissions import belongs_to_organisation, in_facility
from yard.models import (
    Alert, ComplianceCheck, ComplianceConfig, Dock, Equipment, QueueEntry,
)
from yard.reports import compute_turnaround_stats, parse_range

from .serializers import (
    AlertSerializer, DockAssignSerializer, DockCreateSerializer, DockSerializer,
    QueueCreateSerializer, QueueEntrySerializer, QueueUpdateSerializer,
)


def _get_entry_or_404(request, pk):
    entry = QueueEntry.objects.filter(pk=pk).select_related("facility", "assigned_dock").first()
    if (
        entry is None
        or not belongs_to_organisation(entry, request.user)
        or not in_facility(request.user, entry.facility)
    ):
        return None, Response({"ok": False, "error": "not found"}, status=404)
    return entry, None


class YardBoardView(APIView):
    """Queue + docks + alerts digest (poll target for the PWA)."""

    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "queue"

    def get(self, request):
        facility, err = resolve_facility(request)
        if err is not None:
            return err
        entries = QueueEntry.objects.filter(facility=facility).select_related(
            "assigned_dock",
        )
        docks = Dock.objects.filter(facility=facility).select_related("current_entry")
        alerts = Alert.objects.filter(facility=facility)
        counts: dict[str, int] = {}
        for entry in entries:
            counts[entry.status] = counts.get(entry.status, 0) + 1
        return Response({
            "ok": True,
            "facility": {"id": facility.id, "name": facility.name, "slug": facility.slug},
            "queue": [QueueEntrySerializer(e).data for e in entries],
            "docks": [DockSerializer(d).data for d in docks],
            "alerts": [AlertSerializer(a).data for a in alerts[:100]],
            "counts": counts,
            "alerts_unacknowledged": alerts.filter(acknowledged=False).count(),
        })


class QueueListView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "queue"

    def get(self, request):
        facility, err = resolve_facility(request)
        if err is not None:
            return err
        entries = QueueEntry.objects.filter(facility=facility)
        rows = [QueueEntrySerializer(e).data for e in entries]
        return Response({"ok": True, "count": len(rows), "queue": rows})

    def post(self, request):
        serializer = QueueCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        facility = find_facility(str(validated["facility"]), request.user)
        if facility is None:
            return Response({"ok": False, "error": "not found"}, status=404)

        reg = validated["reg_number"].upper()
        key = validated.get("idempotency_key", "")
        try:
            with transaction.atomic():
                entry = QueueEntry.objects.create(
                    organisation=facility.organisation,
                    facility=facility,
                    reg_number=reg,
                    driver_name=validated.get("driver_name", ""),
                    haulier=validated.get("haulier", ""),
                    vehicle_type=validated.get("vehicle_type", ""),
                    cargo_type=validated.get("cargo_type", ""),
                    expected_destination=validated.get("expected_destination", ""),
                    status="QUEUED",
                    idempotency_key=key,
                    created_by=request.user,
                )
                append_audit(
                    facility=facility,
                    action="CREATE_QUEUE_ENTRY",
                    payload={
                        "id": str(entry.id),
                        "facilityId": facility.id,
                        "regNumber": reg,
                        "driverName": entry.driver_name,
                        "haulier": entry.haulier,
                        "vehicleType": entry.vehicle_type,
                        "cargoType": entry.cargo_type,
                        "expectedDestination": entry.expected_destination,
                        "actorId": request.user.username,
                    },
                    actor=request.user,
                )
        except IntegrityError:
            existing = QueueEntry.objects.filter(
                facility=facility, idempotency_key=key,
            ).first() if key else None
            if existing is None:
                raise
            return Response(
                {"ok": True, "idempotent": True,
                 "queue_entry": QueueEntrySerializer(existing).data},
                status=200,
            )
        return Response(
            {"ok": True, "queue_entry": QueueEntrySerializer(entry).data}, status=201,
        )


class QueueDetailView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "queue"

    def patch(self, request, pk):
        entry, err = _get_entry_or_404(request, pk)
        if err is not None:
            return err
        serializer = QueueUpdateSerializer(entry, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        new_status = validated.get("status")
        old_status = entry.status

        if new_status is not None and new_status != old_status:
            if not engine.can_transition(old_status, new_status):
                return Response(
                    {"ok": False, "error":
                     f"invalid status transition {old_status} -> {new_status}"},
                    status=409,
                )
        with transaction.atomic():
            for field, value in validated.items():
                setattr(entry, field, value)
            entry.save(update_fields=[*validated.keys(), "updated_at"])
            if new_status is not None and new_status != old_status:
                append_audit(
                    facility=entry.facility,
                    action="UPDATE_QUEUE_STATUS",
                    payload={"id": str(entry.id), "from": old_status, "to": new_status},
                    actor=request.user,
                )
        return Response({"ok": True, "queue_entry": QueueEntrySerializer(entry).data})


class QueueReleaseView(APIView):
    """Gate exit (operations.ts releaseVehiclePS). SAD section 9 release gate."""

    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "queue"
    rbac_action = "update"

    def post(self, request, pk):
        entry, err = _get_entry_or_404(request, pk)
        if err is not None:
            return err
        if not engine.can_transition(entry.status, "RELEASED"):
            return Response(
                {"ok": False, "error":
                 f"Cannot release entry in status {entry.status} "
                 "(must be COMPLETED or OVERRIDE_APPROVED)"},
                status=409,
            )
        now = timezone.now()
        dwell = max(0, int((now - entry.entry_timestamp).total_seconds()))
        with transaction.atomic():
            entry.status = "RELEASED"
            entry.exit_timestamp = now
            entry.dwell_duration_seconds = dwell
            entry.save(
                update_fields=[
                    "status", "exit_timestamp", "dwell_duration_seconds", "updated_at",
                ],
            )
            if entry.assigned_dock_id:
                dock = entry.assigned_dock
                dock.status = "AVAILABLE"
                dock.current_entry = None
                dock.save(update_fields=["status", "current_entry", "updated_at"])
            append_audit(
                facility=entry.facility,
                action="RELEASE_VEHICLE",
                payload={"queueEntryId": str(entry.id)},
                actor=request.user,
            )
            OutboxEvent.objects.create(
                organisation=entry.organisation,
                facility=entry.facility,
                event_type="RELEASED",
                payload={
                    "queue_entry_id": str(entry.id),
                    "reg_number": entry.reg_number,
                    "dwell_seconds": dwell,
                },
            )
        return Response({"ok": True, "queue_entry": QueueEntrySerializer(entry).data})


class DockListView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "docks"

    def get(self, request):
        facility, err = resolve_facility(request)
        if err is not None:
            return err
        docks = Dock.objects.filter(facility=facility)
        rows = [DockSerializer(d).data for d in docks]
        return Response({"ok": True, "count": len(rows), "docks": rows})

    def post(self, request):
        serializer = DockCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        facility = find_facility(str(validated["facility"]), request.user)
        if facility is None:
            return Response({"ok": False, "error": "not found"}, status=404)
        try:
            dock = Dock.objects.create(
                organisation=facility.organisation,
                facility=facility,
                name=validated["name"],
                capacity_kg=validated.get("capacity_kg", 0.0),
            )
        except IntegrityError:
            return Response(
                {"ok": False, "error": "dock name already exists at this facility"},
                status=409,
            )
        return Response({"ok": True, "dock": DockSerializer(dock).data}, status=201)


class DockAssignView(APIView):
    """assignDockPS: dock must be AVAILABLE; entry moves to AT_DOCK."""

    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "docks"
    rbac_action = "update"

    def post(self, request, pk):
        dock = Dock.objects.filter(pk=pk).select_related("facility").first()
        if (
            dock is None
            or not belongs_to_organisation(dock, request.user)
            or not in_facility(request.user, dock.facility)
        ):
            return Response({"ok": False, "error": "not found"}, status=404)

        serializer = DockAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        entry = serializer.validated_data["queue_entry"]
        if not belongs_to_organisation(entry, request.user) or not in_facility(
            request.user, entry.facility,
        ):
            return Response({"ok": False, "error": "not found"}, status=404)
        if entry.facility_id != dock.facility_id:
            return Response(
                {"ok": False, "error": "entry and dock are at different facilities"},
                status=400,
            )
        if dock.status != "AVAILABLE":
            return Response(
                {"ok": False, "error": "Selected dock is not available"}, status=409,
            )
        if entry.status not in ("QUEUED", "ASSIGNED"):
            return Response(
                {"ok": False, "error":
                 f"Cannot assign entry in status {entry.status} to a dock"},
                status=409,
            )
        with transaction.atomic():
            dock.status = "OCCUPIED"
            dock.current_entry = entry
            dock.save(update_fields=["status", "current_entry", "updated_at"])
            entry.status = "AT_DOCK"
            entry.assigned_dock = dock
            entry.save(update_fields=["status", "assigned_dock", "updated_at"])
            append_audit(
                facility=entry.facility,
                action="ASSIGN_DOCK",
                payload={"queueEntryId": str(entry.id), "dockId": str(dock.id)},
                actor=request.user,
            )
        return Response({
            "ok": True,
            "dock": DockSerializer(dock).data,
            "queue_entry": QueueEntrySerializer(entry).data,
        })


class AlertListView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "alerts"

    def get(self, request):
        facility, err = resolve_facility(request)
        if err is not None:
            return err
        alerts = Alert.objects.filter(facility=facility)
        rows = [AlertSerializer(a).data for a in alerts[:200]]
        return Response({"ok": True, "count": len(rows), "alerts": rows})


class AlertAckView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "alerts"
    rbac_action = "update"

    def post(self, request, pk):
        alert = Alert.objects.filter(pk=pk).select_related("facility").first()
        if (
            alert is None
            or not belongs_to_organisation(alert, request.user)
            or not in_facility(request.user, alert.facility)
        ):
            return Response({"ok": False, "error": "not found"}, status=404)
        with transaction.atomic():
            alert.acknowledged = True
            alert.acknowledged_by = request.user
            alert.acknowledged_at = timezone.now()
            alert.save(
                update_fields=[
                    "acknowledged", "acknowledged_by", "acknowledged_at", "updated_at",
                ],
            )
            append_audit(
                facility=alert.facility,
                action="ACKNOWLEDGE_ALERT",
                payload={"alertId": str(alert.id)},
                actor=request.user,
            )
        return Response({"ok": True, "alert": AlertSerializer(alert).data})


def _report_queryset(request):
    facility, err = resolve_facility(request)
    if err is not None:
        return None, None, err
    start, end, range_err = parse_range(request.query_params)
    if range_err is not None:
        return None, None, Response({"ok": False, "error": range_err}, status=400)
    qs = QueueEntry.objects.filter(facility=facility)
    if start is not None:
        qs = qs.filter(entry_timestamp__gte=start)
    if end is not None:
        qs = qs.filter(entry_timestamp__lte=end)
    return facility, qs, None


class TurnaroundReportView(APIView):
    """Turnaround/wait stats over queue rows (live.ts computeTurnaroundStats)."""

    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "reports"

    def get(self, request):
        facility, qs, err = _report_queryset(request)
        if err is not None:
            return err
        stats = compute_turnaround_stats(list(qs), now=timezone.now())
        return Response({
            "ok": True,
            "facility": {"id": facility.id, "name": facility.name, "slug": facility.slug},
            "from": request.query_params.get("from"),
            "to": request.query_params.get("to"),
            "stats": stats,
        })


class ReportExportView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "reports"

    def get(self, request):
        facility, qs, err = _report_queryset(request)
        if err is not None:
            return err
        rows = qs.order_by("entry_timestamp")
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "id", "reg_number", "driver_name", "haulier", "vehicle_type",
            "cargo_type", "status", "entry_timestamp", "exit_timestamp",
            "dwell_duration_seconds",
        ])
        for row in rows:
            writer.writerow([
                row.id, row.reg_number, row.driver_name, row.haulier,
                row.vehicle_type, row.cargo_type, row.status,
                row.entry_timestamp.isoformat(),
                row.exit_timestamp.isoformat() if row.exit_timestamp else "",
                row.dwell_duration_seconds if row.dwell_duration_seconds is not None else "",
            ])
        resp = HttpResponse(buf.getvalue(), content_type="text/csv")
        resp["Content-Disposition"] = f'attachment; filename="turnaround-{facility.slug}.csv"'
        return resp


# --- Admin demo yard (seed / reset) -----------------------------------------

DEMO_DOCKS = [
    ("Dock 1", 24000.0, "OCCUPIED"),
    ("Dock 2", 24000.0, "AVAILABLE"),
    ("Dock 3", 18000.0, "AVAILABLE"),
    ("Dock 4", 24000.0, "MAINTENANCE"),
]

DEMO_EQUIPMENT = [
    ("FL-01", "FORKLIFT", "AVAILABLE"),
    ("FL-02", "FORKLIFT", "OCCUPIED"),
    ("TR-01", "OTHER", "AVAILABLE"),
]

# id, reg, driver, cargo, vehicle_type, status, dock name or None, destination
DEMO_QUEUE = [
    ("q-seed-1", "AEH 4521", "T. Moyo", "Container", "CONTAINER", "QUEUED", None, "Beitbridge"),
    ("q-seed-2", "AGX 9033", "S. Ndlovu", "Dry van", "DRY_VAN", "ASSIGNED", "Dock 1", "Forbes"),
    ("q-seed-3", "AFM 1187", "K. Sibanda", "Tanker", "TANKER", "QUARANTINED", None, "Chirundu"),
    ("q-seed-4", "ABZ 9901", "R. Dube", "Container", "CONTAINER", "QUEUED", None, "Beitbridge"),
    ("q-seed-6", "ADP 3357", "J. Banda", "Flatbed", "FLATBED", "PENDING_OVERRIDE", None, "Chirundu"),
    ("q-seed-7", "AEW 7712", "M. Hove", "Dry van", "DRY_VAN", "OVERRIDE_APPROVED", None, "Forbes"),
    ("q-seed-8", "AFX 6640", "D. Mutasa", "Container", "CONTAINER", "QUEUED", None, "Beitbridge"),
]

# category, severity, message, related seed queue entry id
DEMO_ALERTS = [
    (
        "COMPLIANCE_FAILURE", "CRITICAL",
        "AFM 1187 quarantined: Axle 2 overloaded by 1,400kg. Rebalancing or override required.",
        "q-seed-3",
    ),
    (
        "EXCESSIVE_WAIT", "HIGH",
        "ABZ 9901 waiting 74m (exceeds 60m threshold).",
        "q-seed-4",
    ),
]


def _facility_from_body(request):
    from core.audit_views import find_facility

    facility_ref = request.data.get("facility")
    if not facility_ref:
        return None, Response(
            {"ok": False, "error": "facility required in body"}, status=400,
        )
    facility = find_facility(str(facility_ref), request.user)
    if facility is None:
        return None, Response({"ok": False, "error": "not found"}, status=404)
    return facility, None


class AdminSeedView(APIView):
    """Idempotent demo yard (BAK live.ts seedDemoFacility). Re-run resets
    seeded statuses - that is what a re-demo wants."""

    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "admin"

    def post(self, request):
        facility, err = _facility_from_body(request)
        if err is not None:
            return err
        created = {"docks": 0, "equipment": 0, "queue": 0, "alerts": 0, "config": 0}
        updated = dict(created)

        with transaction.atomic():
            for name, capacity, status in DEMO_DOCKS:
                obj, was_created = Dock.objects.update_or_create(
                    facility=facility, name=name,
                    defaults={
                        "organisation": facility.organisation,
                        "capacity_kg": capacity,
                        "status": status,
                    },
                )
                if was_created:
                    created["docks"] += 1
                else:
                    updated["docks"] += 1

            for name, kind, status in DEMO_EQUIPMENT:
                obj, was_created = Equipment.objects.update_or_create(
                    facility=facility, name=name,
                    defaults={
                        "organisation": facility.organisation,
                        "kind": kind,
                        "status": status,
                    },
                )
                if was_created:
                    created["equipment"] += 1
                else:
                    updated["equipment"] += 1

            docks_by_name = {d.name: d for d in Dock.objects.filter(facility=facility)}
            for seed_id, reg, driver, cargo, vtype, status, dock_name, dest in DEMO_QUEUE:
                obj, was_created = QueueEntry.objects.update_or_create(
                    facility=facility, idempotency_key=seed_id,
                    defaults={
                        "organisation": facility.organisation,
                        "reg_number": reg,
                        "driver_name": driver,
                        "cargo_type": cargo,
                        "vehicle_type": vtype,
                        "expected_destination": dest,
                        "status": status,
                        "assigned_dock": docks_by_name.get(dock_name),
                        "created_by": request.user,
                    },
                )
                if was_created:
                    created["queue"] += 1
                else:
                    updated["queue"] += 1

            dock1 = docks_by_name.get("Dock 1")
            seed2 = QueueEntry.objects.filter(
                facility=facility, idempotency_key="q-seed-2",
            ).first()
            if dock1 is not None and seed2 is not None:
                Dock.objects.filter(pk=dock1.pk).update(
                    current_entry=seed2, status="OCCUPIED",
                )

            for category, severity, message, seed_id in DEMO_ALERTS:
                related = QueueEntry.objects.filter(
                    facility=facility, idempotency_key=seed_id,
                ).first()
                obj, was_created = Alert.objects.update_or_create(
                    facility=facility, message=message,
                    defaults={
                        "organisation": facility.organisation,
                        "category": category,
                        "severity": severity,
                        "acknowledged": False,
                        "related_queue_entry": related,
                    },
                )
                if was_created:
                    created["alerts"] += 1
                else:
                    updated["alerts"] += 1

            for route in engine.SI_ROUTES:
                for vehicle, limits in engine.DEFAULT_SI_TABLES_BY_ROUTE[route].items():
                    obj, was_created = ComplianceConfig.objects.update_or_create(
                        organisation=facility.organisation,
                        route_type=route,
                        vehicle_type=vehicle,
                        defaults={"axle_limits": limits, "is_active": True},
                    )
                    if was_created:
                        created["config"] += 1
                    else:
                        updated["config"] += 1

            append_audit(
                facility=facility,
                action="SEED_YARD",
                payload={"facilityId": facility.id, "created": created,
                         "updated": updated},
                actor=request.user,
            )
        return Response({"ok": True, "created": created, "updated": updated})


class AdminResetView(APIView):
    """Clear the facility's demo yard (queue/docks/equipment/alerts/checks/
    config). Users, org, facility and the audit chain are untouched; the
    reset itself is appended to the chain (audited, ADMIN-only)."""

    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "admin"
    rbac_action = "update"

    def post(self, request):
        facility, err = _facility_from_body(request)
        if err is not None:
            return err
        deleted = {}
        with transaction.atomic():
            for model in (Alert, ComplianceCheck, QueueEntry, Dock, Equipment,
                          ComplianceConfig):
                if model is ComplianceConfig:
                    count, _ = model.objects.filter(
                        organisation=facility.organisation,
                    ).delete()
                else:
                    count, _ = model.objects.filter(facility=facility).delete()
                deleted[model.__name__] = count
            append_audit(
                facility=facility,
                action="RESET_YARD",
                payload={"facilityId": facility.id, "deleted": deleted},
                actor=request.user,
            )
        return Response({"ok": True, "deleted": deleted})
