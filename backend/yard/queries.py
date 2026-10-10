"""Separate physical yard presence from completed legacy visits."""
from django.db.models import Exists, OuterRef, Q


def active_visits(entries):
    from regulatory.models import InspectionAttempt, ReleaseRecord
    from yard.models import ComplianceCheck

    # A versioned PASS sets a legacy visit to COMPLETED before release. Keep
    # that actionable visit visible; historical seed completions have no attempt.
    return entries.alias(
        has_inspection=Exists(InspectionAttempt.objects.filter(queue_entry_id=OuterRef('pk'))),
        has_legacy_check=Exists(ComplianceCheck.objects.filter(queue_entry_id=OuterRef('pk'))),
        has_release=Exists(ReleaseRecord.objects.filter(queue_entry_id=OuterRef('pk'))),
    ).filter(exit_timestamp__isnull=True).exclude(
        Q(milestone_semantics='LEGACY_COMBINED') & (
            Q(status='RELEASED') | (Q(status='COMPLETED') & (
                (Q(has_inspection=False) & Q(has_legacy_check=False)) | Q(has_release=True)))))


def scoped_visits(entries, scope):
    if scope == 'active':
        return active_visits(entries)
    if scope == 'history':
        return entries.exclude(pk__in=active_visits(entries).values('pk'))
    return entries
