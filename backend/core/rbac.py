"""Server-authoritative RBAC matrix (SAD v2 §5).

Faithful port of web/firestore.rules — the real enforcement
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
    ('regulatory','review'): {UserRole.ADMIN, UserRole.COMPLIANCE_OFFICER},
    ('regulatory','inspect'): {UserRole.DISPATCH_SUPERVISOR},
    ('regulatory','operate'): {UserRole.ADMIN, UserRole.OPERATIONS_SUPERVISOR},
    ('routes','read'): ALL_ROLES,
    ('routes','create'): {UserRole.ADMIN, UserRole.DISPATCH_SUPERVISOR, UserRole.OPERATIONS_SUPERVISOR, UserRole.FACILITY_MANAGER},
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


def rbac_allows(role: str | None, resource: str, action: str, organisation=None, facility=None) -> bool:
    """True if the role may perform action on resource (fail-closed)."""
    if role is None:
        return False
    allowed = ROLE_MATRIX.get((resource, action))
    if allowed is None:
        return False
    if role not in allowed:
        return False
    if organisation is not None:
        from tenancy.registry import RESOURCE_MODULE
        from tenancy.releases import module_enabled
        module = RESOURCE_MODULE.get(resource)
        if action != 'read' and module and not module_enabled(organisation,module):
            return False
        from tenancy.configuration import resolved
        config = resolved(organisation,facility=facility)['content']
        return config['roles'].get(role,{}).get('enabled',False) and role in config['permissions'].get(f'{resource}.{action}',allowed)
    return True


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
        from tenancy.access import enforce_request
        enforce_request(request.user,request)
        resource = getattr(view, "rbac_resource", None)
        if resource is None:
            return False  # fail-closed: no resource declared, no access
        action = getattr(view, "rbac_action", None) or _METHOD_ACTION.get(request.method)
        if action is None:
            return False
        from trip.permissions import get_user_organisation,user_facilities
        org = get_user_organisation(request.user)
        ref = request.query_params.get('facility') if request.method in ('GET','HEAD') else request.data.get('facility')
        site = None
        if ref:
            from core.audit_views import find_facility
            site = find_facility(str(ref),request.user)
        elif getattr(view,'kwargs',{}).get('pk'):
            from yard.models import QueueEntry,Dock,Alert,ComplianceCheck
            models = {'queue':QueueEntry,'docks':Dock,'alerts':Alert,'compliance':ComplianceCheck}
            model = models.get(resource)
            if model:
                try:
                    site_id = model.objects.filter(pk=view.kwargs['pk'],organisation=org).values_list('facility_id',flat=True).first()
                    site = user_facilities(request.user).filter(pk=site_id,organisation=org).first()
                except (ValueError,TypeError):
                    pass  # The view will return its normal invalid/missing-object response.
        return rbac_allows(get_user_role(request.user), resource, action, org, site)
