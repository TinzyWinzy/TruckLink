"""Yard endpoints (SAD v2 section 11): board digest, queue, docks, alerts.

Ports of bak-logistics-app/src/lib/powersync/operations.ts:
  registerVehiclePS / assignDockPS / releaseVehiclePS / acknowledgeAlertPS.
Release gate (section 9): only COMPLETED or OVERRIDE_APPROVED may be released;
the gate is engine.can_transition(status, "RELEASED") - one FSM, one truth.
"""
from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from compliance import engine
from core.audit import append_audit
from core.audit_views import resolve_facility
from core.rbac import RoleAccess
from trip.permissions import belongs_to_organisation, in_facility
from yard.models import Alert, Dock, QueueEntry

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
        facility = validated["facility"]
        if not in_facility(request.user, facility):
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
        facility = validated["facility"]
        if not in_facility(request.user, facility):
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
