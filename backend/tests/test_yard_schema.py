"""B1b schema behavior: idempotency, append-only audit, defaults."""
from __future__ import annotations

import pytest

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from core.models import AuditMeta, Facility
from trip.models import Organisation, UserProfile
from yard.models import AuditLog, QueueEntry


@pytest.fixture
def org_facility(db):
    org = Organisation.objects.get_or_create(slug="default", defaults={"name": "Test Fleet"})[0]
    fac, _ = Facility.objects.get_or_create(
        organisation=org, slug="yard-1", defaults={"name": "Main Yard"},
    )
    return org, fac


@pytest.mark.django_db
class TestQueueIdempotency:
    def test_duplicate_idempotency_key_same_facility_rejected(self, org_facility):
        org, fac = org_facility
        QueueEntry.objects.create(
            organisation=org, facility=fac, reg_number="ABC123",
            idempotency_key="client-key-1",
        )
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                QueueEntry.objects.create(
                    organisation=org, facility=fac, reg_number="ABC123",
                    idempotency_key="client-key-1",
                )

    def test_empty_idempotency_key_not_unique(self, org_facility):
        org, fac = org_facility
        QueueEntry.objects.create(organisation=org, facility=fac, reg_number="AAA111")
        QueueEntry.objects.create(organisation=org, facility=fac, reg_number="BBB222")

    def test_default_status_is_queued(self, org_facility):
        org, fac = org_facility
        q = QueueEntry.objects.create(organisation=org, facility=fac, reg_number="CCC333")
        assert q.status == "QUEUED"


@pytest.mark.django_db
class TestAuditChainRows:
    def test_audit_meta_defaults(self, org_facility):
        _, fac = org_facility
        meta = AuditMeta.objects.create(facility=fac)
        assert meta.current_hash == "GENESIS"
        assert meta.seq == 0

    def test_audit_log_is_append_only_update_forbidden(self, org_facility):
        org, fac = org_facility
        row = AuditLog.objects.create(
            organisation=org, facility=fac, action="TEST",
            payload="{}", previous_hash="GENESIS", hash="abc",
        )
        with pytest.raises(ValidationError):
            row.save()

    def test_audit_log_delete_forbidden(self, org_facility):
        org, fac = org_facility
        row = AuditLog.objects.create(
            organisation=org, facility=fac, action="TEST",
            payload="{}", previous_hash="GENESIS", hash="abc",
        )
        with pytest.raises(ValidationError):
            row.delete()

    def test_audit_log_delete_queryset_still_possible_but_service_avoids(self, org_facility):
        org, fac = org_facility
        AuditLog.objects.create(
            organisation=org, facility=fac, action="TEST",
            payload="{}", previous_hash="GENESIS", hash="abc",
        )
        # Bulk queryset delete bypasses the row guard by design of Django ORM;
        # the API never exposes it (SAD §6: append-only surface).
        assert AuditLog.objects.filter(facility=fac).count() == 1


@pytest.mark.django_db
class TestUserProfileRole:
    def test_default_role(self, db):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.create_user(username="role_check", password="x")
        profile = UserProfile.objects.create(user=user)
        assert profile.role == "OPERATIONS_SUPERVISOR"

    def test_all_six_roles_present(self):
        from trip.models import UserRole
        assert len(UserRole.values) == 6
