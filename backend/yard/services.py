"""Authoritative yard commands shared by API entry points."""
from django.db import transaction
from django.core.exceptions import ValidationError
from django.utils import timezone

from compliance.policy import missing_checks
from core.audit import append_audit
from core.models import OutboxEvent
from yard.models import ComplianceCheck, Dock, QueueEntry


class ReleaseBlocked(ValueError):
    pass


@transaction.atomic
def release_entry(entry_id, actor):
    # All gate mutations lock the queue row first, then checks/docks.
    entry = QueueEntry.objects.select_for_update().get(pk=entry_id)
    from core.models import Facility
    Facility.objects.select_for_update().get(pk=entry.facility_id)
    from journeys.models import JourneyLink
    link = JourneyLink.objects.filter(visit=entry).first()
    if link:
        from trip.models import Trip
        from journeys.services import check_assignment
        link.trip = Trip.objects.select_for_update().get(pk=link.trip_id)
        try:
            check_assignment(link)
        except ValidationError as exc:
            raise ReleaseBlocked('; '.join(exc.messages)) from exc
    attempt = approval = None
    if entry.facility.yard_config.get("mode") != "DEMO" or entry.inspection_attempts.exists():
        from regulatory.services import release_authority
        try:
            attempt, approval = release_authority(entry, actor)
        except (ValidationError, PermissionError) as exc:
            raise ReleaseBlocked('; '.join(exc.messages) if isinstance(exc, ValidationError) else str(exc)) from exc
        authority = {"attempt_id": attempt.pk, "approval_id": approval.pk if approval else None}
        if link and attempt.context.trip_id != link.trip_id:
            raise ReleaseBlocked('Inspection release authority belongs to another journey')
        from regulatory.models import ReleaseWithdrawal
        withdrawal=ReleaseWithdrawal.objects.filter(release__queue_entry=entry).order_by('-created_at','-pk').first()
        if withdrawal and attempt.created_at <= withdrawal.created_at:
            raise ReleaseBlocked('Record a fresh inspection after release withdrawal')
    else:
        check = validate_demo_release(entry)
        authority = {"check_id": str(check.id), "verification_status": "LEGACY_DEMO_UNVERIFIED"}
    now = timezone.now()
    entry.status = "RELEASED"
    entry.release_authorized_at = now
    separate = entry.milestone_semantics == 'SEPARATE_V1'
    if not separate:
        entry.exit_timestamp = now
        entry.dwell_duration_seconds = max(0, int((now - entry.entry_timestamp).total_seconds()))
    entry.save(update_fields=["status", "release_authorized_at", "exit_timestamp", "dwell_duration_seconds", "updated_at"])
    if attempt:
        from regulatory.models import ReleaseRecord
        ReleaseRecord.objects.create(organisation=entry.organisation, creator=actor, queue_entry=entry, attempt=attempt, approval=approval)
    if entry.assigned_dock_id and not separate:
        dock = Dock.objects.select_for_update().get(pk=entry.assigned_dock_id)
        if dock.current_entry_id == entry.pk:
            dock.status = "AVAILABLE"
            dock.current_entry = None
            dock.save(update_fields=["status", "current_entry", "updated_at"])
    append_audit(facility=entry.facility, action="RELEASE_VEHICLE", actor=actor,
                 payload={"queueEntryId": str(entry.id), **authority})
    OutboxEvent.objects.create(organisation=entry.organisation, facility=entry.facility,
                              event_type="RELEASE_AUTHORISED" if separate else "RELEASED", payload={"queue_entry_id": str(entry.id),
                              **authority, "trip_id": link.trip_id if link else None,
                              "journey_id": link.pk if link else None, "reg_number": entry.reg_number,
                              "milestone_semantics": entry.milestone_semantics,
                              "release_authorized_at": now.isoformat(),
                              "dwell_seconds": entry.dwell_duration_seconds})
    return entry


def validate_demo_release(entry):
    if entry.status not in ("COMPLETED", "OVERRIDE_APPROVED"):
        raise ReleaseBlocked(f"Cannot release entry in status {entry.status}")
    check = ComplianceCheck.objects.filter(queue_entry=entry).order_by("-timestamp", "-pk").first()
    expected = "PASSED" if entry.status == "COMPLETED" else "OVERRIDE_APPROVED"
    if (check is None or check.status != expected or check.inspector_id is None
            or check.organisation_id != entry.organisation_id
            or check.facility_id != entry.facility_id
            or missing_checks(check.checklist_results, entry.organisation)):
        raise ReleaseBlocked("Cannot release without a current authorized inspection and mandatory checks")
    if expected == "OVERRIDE_APPROVED":
        if (not check.override_reason.strip() or not check.override_requester_id
                or not check.override_authorizer_id
                or check.override_authorizer_id in (check.override_requester_id, check.inspector_id)):
            raise ReleaseBlocked("Cannot release without independent override approval")
    return check
