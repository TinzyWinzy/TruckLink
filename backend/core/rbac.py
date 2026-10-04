"""Server-authoritative RBAC matrix (SAD v2 §5).

Faithful port of bak-logistics-app/firestore.rules — the real enforcement
that existed client-side in BAK. The client gates.ts copy is UI affordance
only; this module + tests keep them from drifting.

Base gate for every yard resource is facility membership (scope_facility /
in_facility) — the matrix below decides role eligibility *inside* a facility.
"""
from __future__ import annotations

from rest_framework.permissions import BasePermission, SAFE_METHODS

from trip.models import UserRole
from trip.permissions import get_user_role

ALL_ROLES = {
    UserRole.DISPATCH_SUPERVISOR,
    UserRole.OPERATIONS_SUPERVISOR,
    UserRole.FACILITY_MANAGER,
    UserRole.EXECUTIVE,
    UserRole.ADMIN,
    UserRole.COMPLIANCE_OFFICER,
}

# (resource, action) -> allowed roles. Actions: read | create | update | delete
# Unknown (resource, action) => deny (fail-closed).
ROLE_MATRIX: dict[tuple[str, str], set[str]] = {
    # queue: create=DISPATCH/OPERATIONS, update adds FACILITY, read=members,
    # delete=never (firestore: allow delete: if false)
    ("queue", "read"): ALL_ROLES,
    ("queue", "create"): {UserRole.DISPATCH_SUPERVISOR, UserRole.OPERATIONS_SUPERVISOR},
    ("queue", "update"): {UserRole.DISPATCH_SUPERVISOR, UserRole.OPERATIONS_SUPERVISOR, UserRole.FACILITY_MANAGER},
    ("queue", "delete"): set(),
    # compliance checks: create=DISPATCH, update (override ops)=OPERATIONS/ADMIN
    ("compliance", "read"): ALL_ROLES,
    ("compliance", "create"): {UserRole.DISPATCH_SUPERVISOR},
    ("compliance", "update"): {UserRole.OPERATIONS_SUPERVISOR, UserRole.ADMIN},
    ("compliance", "delete"): set(),
    # docks: assign/release = update (OPERATIONS/FACILITY); CRUD = ADMIN
    ("docks", "read"): ALL_ROLES,
    ("docks", "update"): {UserRole.OPERATIONS_SUPERVISOR, UserRole.FACILITY_MANAGER},
    ("docks", "create"): {UserRole.ADMIN},
    ("docks", "delete"): {UserRole.ADMIN},
    # equipment mirrors docks
    ("equipment", "read"): ALL_ROLES,
    ("equipment", "update"): {UserRole.OPERATIONS_SUPERVISOR, UserRole.FACILITY_MANAGER},
    ("equipment", "create"): {UserRole.ADMIN},
    ("equipment", "delete"): {UserRole.ADMIN},
    # alerts: create=yard roles; update (ack)=OPERATIONS/FACILITY/ADMIN;
    # read=members; delete=never
    ("alerts", "read"): ALL_ROLES,
    ("alerts", "create"): {UserRole.DISPATCH_SUPERVISOR, UserRole.OPERATIONS_SUPERVISOR, UserRole.FACILITY_MANAGER},
    ("alerts", "update"): {UserRole.OPERATIONS_SUPERVISOR, UserRole.FACILITY_MANAGER, UserRole.ADMIN},
    ("alerts", "delete"): set(),
    # audit log: server appends only; read = COMPLIANCE/ADMIN/EXECUTIVE/FACILITY
    ("audit", "read"): {UserRole.COMPLIANCE_OFFICER, UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.FACILITY_MANAGER},
    ("audit", "create"): set(),
    ("audit", "update"): set(),
    ("audit", "delete"): set(),
    # S.I. config: read=members, write=ADMIN (firestore complianceConfig)
    ("compliance_config", "read"): ALL_ROLES,
    ("compliance_config", "create"): {UserRole.ADMIN},
    ("compliance_config", "update"): {UserRole.ADMIN},
    ("compliance_config", "delete"): {UserRole.ADMIN},
    # reports (SAD §11 / gates.ts ROUTE_GATES.reports)
    ("reports", "read"): {UserRole.OPERATIONS_SUPERVISOR, UserRole.FACILITY_MANAGER, UserRole.EXECUTIVE, UserRole.ADMIN},
    # tenant admin surface (gates.ts ROUTE_GATES.admin + firestore users write)
    ("admin", "read"): {UserRole.ADMIN},
    ("admin", "update"): {UserRole.ADMIN},
    ("admin", "create"): {UserRole.ADMIN},
    ("admin", "delete"): {UserRole.ADMIN},
    # user directory: read self-or-ADMIN (handled in view), write ADMIN
    ("users", "read"): ALL_ROLES,
    ("users", "create"): {UserRole.ADMIN},
    ("users", "update"): {UserRole.ADMIN},
    ("users", "delete"): set(),
}


def rbac_allows(role: str | None, resource: str, action: str) -> bool:
    """True if the role may perform action on resource (fail-closed)."""
    if role is None:
        return False
    allowed = ROLE_MATRIX.get((resource, action))
    if allowed is None:
        return False
    return role in allowed


_METHOD_ACTION = {
    "GET": "read",
    "HEAD": "read",
    "OPTIONS": "read",
    "POST": "create",
    "PUT": "update",
    "PATCH": "update",
    "DELETE": "delete",
}


class RoleAccess(BasePermission):
    """DRF gate driven by the matrix. Views declare `rbac_resource`
    (and optionally `rbac_action` to override method-derived action)."""

    def has_permission(self, request, view):
        resource = getattr(view, "rbac_resource", None)
        if resource is None:
            return False  # fail-closed: no resource declared, no access
        action = getattr(view, "rbac_action", None) or _METHOD_ACTION.get(request.method)
        if action is None:
            return False
        return rbac_allows(get_user_role(request.user), resource, action)
