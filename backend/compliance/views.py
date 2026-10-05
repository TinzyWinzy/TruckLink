"""Compliance endpoints (SAD v2 section 9 / 11).

POST /api/compliance/  - run statutory check; FAIL quarantines the queue entry
                         and raises a CRITICAL alert in the same transaction.
POST .../override-request  - QUARANTINED -> PENDING_OVERRIDE (reason required).
POST .../override-approve   - requester != approver hard check (section 9).
Server result is final; both override actors are recorded on the audit chain.
"""
from __future__ import annotations

from django.db import transaction
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.audit import append_audit
from core.audit_views import resolve_facility
from core.models import OutboxEvent
from core.rbac import RoleAccess
from trip.permissions import (
    belongs_to_organisation, in_facility, scope_organisation,
)
from yard.models import (
    Alert, CheckStatus, ComplianceCheck, ComplianceConfig, QueueEntry,
)

from . import engine
from .serializers import ComplianceCreateSerializer, OverrideSerializer


def _tenant_remote(organisation) -> dict:
    remote: dict = {"siTablesByRoute": {}}
    rows = ComplianceConfig.objects.filter(organisation=organisation, is_active=True)
    for row in rows:
        remote["siTablesByRoute"].setdefault(row.route_type.upper(), {})[
            row.vehicle_type.upper()
        ] = row.axle_limits
    return remote


def _serialize_check(check: ComplianceCheck) -> dict:
    return {
        "id": str(check.id),
        "queue_entry_id": check.queue_entry_id,
        "reg_number": check.reg_number,
        "vehicle_type": check.vehicle_type,
        "route_type": check.route_type,
        "axle_weights": check.axle_weights,
        "measured_total_kg": check.measured_total_kg,
        "max_permissible_kg": check.max_permissible_kg,
        "overload_kg": check.overload_kg,
        "overload_fee_usd": check.overload_fee_usd,
        "checklist_results": check.checklist_results,
        "status": check.status,
        "overall_status": "PASS" if check.status == CheckStatus.PASSED else "FAIL",
        "violations": check.checklist_results.get("violations", [])
        if isinstance(check.checklist_results, dict) else [],
        "inspector": check.inspector.username if check.inspector else None,
        "override_reason": check.override_reason,
        "override_requester": check.override_requester.username
        if check.override_requester else None,
        "override_authorizer": check.override_authorizer.username
        if check.override_authorizer else None,
        "timestamp": check.timestamp.isoformat(),
    }


def _get_check_or_404(request, pk):
    check = ComplianceCheck.objects.filter(pk=pk).select_related(
        "facility", "queue_entry",
    ).first()
    if (
        check is None
        or not belongs_to_organisation(check, request.user)
        or not in_facility(request.user, check.facility)
    ):
        return None, Response({"ok": False, "error": "not found"}, status=404)
    return check, None


class ComplianceListView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "compliance"

    def get(self, request):
        facility, err = resolve_facility(request)
        if err is not None:
            return err
        checks = ComplianceCheck.objects.filter(facility=facility).select_related(
            "inspector", "override_requester", "override_authorizer",
        )
        entries = [_serialize_check(c) for c in checks]
        return Response({"ok": True, "count": len(entries), "checks": entries})

    def post(self, request):
        serializer = ComplianceCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data
        entry: QueueEntry = validated["queue_entry"]
        user = request.user
        if (
            not belongs_to_organisation(entry, user)
            or not in_facility(user, entry.facility)
        ):
            return Response({"ok": False, "error": "not found"}, status=404)
        client_key = validated.get("client_key") or ""
        if client_key:
            existing = ComplianceCheck.objects.filter(
                organisation=entry.organisation, client_key=client_key,
            ).first()
            if existing is not None:
                return Response(
                    {"ok": True, "check": _serialize_check(existing), "replayed": True},
                )
        if entry.status == "RELEASED":
            return Response(
                {"ok": False, "error": "cannot check a released entry"}, status=409,
            )

        vehicle_type = engine.normalize_vehicle(
            validated.get("vehicle_type") or entry.vehicle_type,
        )
        route_type = engine.normalize_route(validated.get("route_type"))
        try:
            limits = validated.get("limits") or engine.resolve_si_limits(
                route_type, vehicle_type, _tenant_remote(entry.organisation),
            )
            result = engine.validate_load(
                measured_weights=validated["axle_weights"],
                limits=limits,
                total_weight=validated["total_weight"],
                gvm_rating=validated["gvm_rating"],
            )
        except engine.ComplianceInputError as exc:
            return Response({"ok": False, "error": str(exc)}, status=400)

        okg = engine.overload_kg(
            result["axles"], validated["total_weight"], validated["gvm_rating"],
        )
        fee = engine.overload_fee_usd(okg)
        passed = result["overall_status"] == "PASS"
        reg = entry.reg_number.upper()

        with transaction.atomic():
            check = ComplianceCheck.objects.create(
                organisation=entry.organisation,
                facility=entry.facility,
                queue_entry=entry,
                reg_number=reg,
                vehicle_type=vehicle_type,
                route_type=route_type,
                axle_weights=validated["axle_weights"],
                measured_total_kg=validated["total_weight"],
                max_permissible_kg=validated["gvm_rating"],
                overload_kg=okg,
                overload_fee_usd=fee,
                checklist_results={
                    **validated.get("checklist_results", {}),
                    "violations": result["violations"],
                    "axles": result["axles"],
                    "gvm_status": result["gvm_status"],
                },
                client_key=client_key,
                status=CheckStatus.PASSED if passed else CheckStatus.QUARANTINED,
                inspector=user,
            )
            if passed:
                entry.status = "COMPLETED"
                entry.save(update_fields=["status", "updated_at"])
            else:
                entry.status = "QUARANTINED"
                entry.save(update_fields=["status", "updated_at"])
                Alert.objects.create(
                    organisation=entry.organisation,
                    facility=entry.facility,
                    severity="CRITICAL",
                    category="COMPLIANCE",
                    related_queue_entry=entry,
                    message=(
                        f"QUARANTINE: {reg} failed axle check "
                        f"(+{okg:g}kg, fine ${fee:g}). Rebalancing required."
                    ),
                )
                OutboxEvent.objects.create(
                    organisation=entry.organisation,
                    facility=entry.facility,
                    event_type="QUARANTINE",
                    payload={
                        "check_id": check.id,
                        "queue_entry_id": str(entry.id),
                        "reg_number": reg,
                        "overload_kg": okg,
                        "overload_fee_usd": fee,
                    },
                )
            append_audit(
                facility=entry.facility,
                action="SUBMIT_COMPLIANCE",
                payload={
                    "checkId": str(check.id),
                    "status": check.status,
                    "overloadKg": okg,
                    "fineUsd": fee,
                },
                actor=user,
            )
        return Response(
            {"ok": True, "check": _serialize_check(check)}, status=201,
        )


class ComplianceConfigListView(APIView):
    """Tenant S.I. axle-limit rows (org-scoped; client merges with bundled
    pilot tables exactly like BAK's resolveSiLimits chain)."""

    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "compliance_config"

    def get(self, request):
        rows = scope_organisation(
            ComplianceConfig.objects.filter(is_active=True), request.user,
        )
        data = [
            {
                "route_type": row.route_type,
                "vehicle_type": row.vehicle_type,
                "axle_limits": row.axle_limits,
            }
            for row in rows
        ]
        return Response({"ok": True, "count": len(data), "config": data})


class ComplianceOverrideRequestView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "compliance"
    rbac_action = "update"

    def post(self, request, pk):
        check, err = _get_check_or_404(request, pk)
        if err is not None:
            return err
        if check.status != CheckStatus.QUARANTINED:
            return Response(
                {"ok": False, "error": f"Cannot request override from status {check.status}"},
                status=409,
            )
        serializer = OverrideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = serializer.validated_data["reason"]

        with transaction.atomic():
            check.status = CheckStatus.PENDING_OVERRIDE
            check.override_requester = request.user
            check.save(update_fields=["status", "override_requester", "updated_at"])
            entry = check.queue_entry
            if entry.status == "QUARANTINED":
                entry.status = "PENDING_OVERRIDE"
                entry.save(update_fields=["status", "updated_at"])
            append_audit(
                facility=check.facility,
                action="REQUEST_OVERRIDE",
                payload={"checkId": str(check.id), "reason": reason},
                actor=request.user,
            )
        return Response({"ok": True, "check": _serialize_check(check)})


class ComplianceOverrideApproveView(APIView):
    permission_classes = [IsAuthenticated, RoleAccess]
    rbac_resource = "compliance"
    rbac_action = "update"

    def post(self, request, pk):
        check, err = _get_check_or_404(request, pk)
        if err is not None:
            return err
        if check.status != CheckStatus.PENDING_OVERRIDE:
            return Response(
                {"ok": False, "error": f"Cannot override check with status {check.status}"},
                status=409,
            )
        serializer = OverrideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = serializer.validated_data["reason"]
        approved = serializer.validated_data["approved"]

        approver = request.user
        requester = check.override_requester or check.inspector
        if requester is not None and requester.pk == approver.pk:
            return Response(
                {"ok": False, "error": (
                    "Secondary approval violation: approver cannot be the "
                    "requester or original inspector"
                )},
                status=400,
            )
        if check.inspector_id == approver.pk:
            return Response(
                {"ok": False, "error": (
                    "Secondary approval violation: approver cannot be the "
                    "requester or original inspector"
                )},
                status=400,
            )

        with transaction.atomic():
            entry = check.queue_entry
            if approved:
                check.status = CheckStatus.OVERRIDE_APPROVED
                check.override_authorizer = approver
                check.override_reason = reason
                check.save(
                    update_fields=[
                        "status", "override_authorizer", "override_reason",
                        "updated_at",
                    ],
                )
                if entry.status != "RELEASED":
                    entry.status = "OVERRIDE_APPROVED"
                    entry.save(update_fields=["status", "updated_at"])
                action = "APPROVE_OVERRIDE"
            else:
                check.status = CheckStatus.QUARANTINED
                check.override_authorizer = approver
                check.override_reason = reason
                check.save(
                    update_fields=[
                        "status", "override_authorizer", "override_reason",
                        "updated_at",
                    ],
                )
                if entry.status == "PENDING_OVERRIDE":
                    entry.status = "QUARANTINED"
                    entry.save(update_fields=["status", "updated_at"])
                action = "REJECT_OVERRIDE"
            append_audit(
                facility=check.facility,
                action=action,
                payload={"checkId": str(check.id), "reason": reason},
                actor=approver,
            )
        return Response({"ok": True, "check": _serialize_check(check)})
