"""Retired historical baseline probe; retained as audit evidence.

Run from backend with its virtualenv Python: python ../docs/audit/reproduce_findings.py
Assertions describe audit evidence, NOT desired product behavior. Never run against
a deployed API. No existing database, credentials, or external service is used.
"""
raise SystemExit("Historical baseline probe retired after stabilization. Run backend pytest tests/test_gate_integrity.py for current authority regressions; audit metadata hashing remains an open finding.")

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
os.environ["DJANGO_SETTINGS_MODULE"] = "spotter_backend.settings"
os.environ["DJANGO_SECRET_KEY"] = "isolated-audit-only"
import django
from django.conf import settings

settings.DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
settings.AUDIT_SALT = "isolated-audit-only"
settings.ALLOWED_HOSTS = ["testserver"]
django.setup()

from django.core.management import call_command
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from core.models import Facility
from trip.models import Organisation, UserProfile, UserRole
from yard.models import QueueEntry, ComplianceCheck, ComplianceConfig, AuditLog
from core.audit import verify_chain

call_command("migrate", verbosity=0)
org = Organisation.objects.create(name="Audit", slug="audit")
site_a = Facility.objects.create(organisation=org, name="A", slug="a")
site_b = Facility.objects.create(organisation=org, name="B", slug="b")

def client_for(name, role, site):
    user = get_user_model().objects.create_user(username=name)
    profile = UserProfile.objects.create(user=user, organisation=org, role=role)
    profile.facilities.add(site)
    client = APIClient()
    client.force_authenticate(user)
    return client

dispatch_a = client_for("dispatch-a", UserRole.DISPATCH_SUPERVISOR, site_a)
dispatch_b = client_for("dispatch-b", UserRole.DISPATCH_SUPERVISOR, site_b)
ops_a = client_for("ops-a", UserRole.OPERATIONS_SUPERVISOR, site_a)
admin_a = client_for("admin-a", UserRole.ADMIN, site_a)

def entry(site, status="AT_DOCK"):
    return QueueEntry.objects.create(organisation=org, facility=site,
                                     reg_number="AUDIT 1", status=status)

def post_check(client, row, **extra):
    body = {"queue_entry": row.id, "axle_weights": [6000, 8000, 8000],
            "total_weight": 22000, "gvm_rating": 24000}
    body.update(extra)
    return client.post("/api/compliance/", body, format="json")

row = entry(site_a)
r = post_check(dispatch_a, row, axle_weights=[20000, 20000, 20000],
               total_weight=60000, gvm_rating=100000, limits=[100000]*3)
assert r.status_code == 201 and r.data["check"]["overall_status"] == "PASS", r.data
print("CONFIRMED: caller-selected limits and GVM produce PASS on 60,000kg input")

row = entry(site_a)
r = post_check(dispatch_a, row, checklist_results={"driver-license": False})
assert r.status_code == 201 and r.data["check"]["overall_status"] == "PASS", r.data
print("CONFIRMED: failed mandatory checklist metadata does not block server PASS")

row = entry(site_a, "QUARANTINED")
for status in ("PENDING_OVERRIDE", "OVERRIDE_APPROVED", "RELEASED"):
    r = ops_a.patch(f"/api/queue/{row.id}/", {"status": status}, format="json")
    assert r.status_code == 200, r.data
row.refresh_from_db()
assert row.status == "RELEASED" and row.exit_timestamp is None
assert not ComplianceCheck.objects.filter(queue_entry=row).exists()
print("CONFIRMED: generic PATCH reaches RELEASED from quarantine without approval/check/exit stamp")

row_a, row_b = entry(site_a), entry(site_b)
r = post_check(dispatch_a, row_a, client_key="shared-audit-key")
assert r.status_code == 201, r.data
check_id = r.data["check"]["id"]
r = post_check(dispatch_b, row_b, client_key="shared-audit-key")
assert r.status_code == 200 and r.data["check"]["id"] == check_id, r.data
assert r.data["check"]["queue_entry_id"] == row_a.id
print("CONFIRMED: idempotency replay returns facility A check to facility B-only user in same org")

ComplianceConfig.objects.create(organisation=org, axle_limits=[8000,9000,9000])
r = admin_a.post("/api/admin/reset/", {"facility": site_a.id}, format="json")
assert r.status_code == 200 and not ComplianceConfig.objects.filter(organisation=org).exists()
print("CONFIRMED: reset of one facility deletes organisation-wide compliance configuration")

assert verify_chain(site_a)["ok"]
audit_row = AuditLog.objects.filter(facility=site_a).first()
AuditLog.objects.filter(pk=audit_row.pk).update(action="ALTERED_ACTION", actor_ref="altered")
assert verify_chain(site_a)["ok"]
print("CONFIRMED: chain verification does not detect action/actor_ref metadata modification")

anonymous = APIClient()
r = anonymous.post("/api/auth/register/", {"username": "audit-public",
                    "password": "audit-only-password-123", "name": "Audit Public"}, format="json")
assert r.status_code == 201, r.data
public = get_user_model().objects.get(username="audit-public")
assert public.profile.organisation.slug == "default"
assert public.profile.role == UserRole.OPERATIONS_SUPERVISOR
print("CONFIRMED: public legacy registration joins shared default org with operations role")
unaffiliated = get_user_model().objects.create_user(username="audit-no-profile")
unscoped = APIClient()
unscoped.force_authenticate(unaffiliated)
r = unscoped.post("/api/vehicles/", {"plate": "AUDIT UNBOUND"}, format="json")
assert r.status_code == 201, r.data
from trip.models import Vehicle
created_vehicle = Vehicle.objects.get(plate="AUDIT UNBOUND")
assert created_vehicle.organisation_id == org.id
print("CONFIRMED: authenticated user without an organisation creates vehicle in first active org")
print("All eight audit probes reproduced; in-memory database discarded on exit.")
