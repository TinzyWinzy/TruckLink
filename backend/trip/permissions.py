"""Custom DRF permission classes and helpers for tenant/facility isolation.

SAD v2 §5: staff (is_staff) bypass is REMOVED for production — everyone is
scoped by their UserProfile organisation/facility membership. The ADMIN role
replaces the old is_staff shortcut for admin surfaces.
"""
from rest_framework.permissions import BasePermission, SAFE_METHODS
from django.db.models import Q

from .models import Organisation, UserRole


def get_user_role(user):
    """Return the user's UserRole value or None (no profile / anonymous)."""
    if not user or not getattr(user, "is_authenticated", False):
        return None
    profile = getattr(user, "profile", None)
    if profile is None:
        return None
    role = getattr(user, "_working_role", profile.role) if profile.role == UserRole.ADMIN else profile.role
    if role not in UserRole.values:
        return None
    from tenancy.configuration import role_enabled
    return role if profile.organisation_id and role_enabled(profile.organisation,role) else None


def get_user_organisation(user):
    """Resolve the organisation for a given user.

    Checks UserProfile first, falls back to Driver profile, then default org.
    """
    if hasattr(user, "profile") and user.profile.organisation_id:
        return user.profile.organisation
    if hasattr(user, "driver_profile") and user.driver_profile and user.driver_profile.organisation_id:
        return user.driver_profile.organisation
    return None


def scope_organisation(qs, user, org_field="organisation"):
    """Filter a queryset to the user's organisation (no bypass: SAD §5)."""
    org = get_user_organisation(user)
    if org is None:
        return qs.none()
    qs = qs.filter(**{org_field: org})
    # New yard-assigned trips retain their scope through legacy fleet APIs.
    prefix = 'trip__' if org_field == 'trip__organisation' else ''
    if prefix or qs.model._meta.label_lower == 'trip.trip':
        qs = qs.filter(Q(**{f'{prefix}facility__isnull': True}) | Q(**{
            f'{prefix}facility__in': user_facilities(user).filter(organisation=org,is_deleted=False)}))
    return qs


def belongs_to_organisation(obj, user):
    """Check if an object belongs to the user's organisation (no bypass)."""
    org = get_user_organisation(user)
    if org is None:
        return False
    obj_org = getattr(obj, "organisation", None)
    if obj_org is None:
        obj_org = getattr(obj, "organisation_id", None)
    if obj_org != org:
        return False
    facility = getattr(obj, 'facility', None)
    return facility is None or (facility.organisation_id == org.id and not facility.is_deleted and in_facility(user,facility))


def user_facilities(user):
    """Facilities the user may act inside (profile.facilities M2M)."""
    if not getattr(user, "is_authenticated", False):
        from core.models import Facility
        return Facility.objects.none()
    profile = getattr(user, "profile", None)
    if profile is None:
        from core.models import Facility
        return Facility.objects.none()
    return profile.facilities.all()


def in_facility(user, facility):
    """True if the user is a member of the given facility (firestore inFacility)."""
    if facility is None:
        return False
    return user_facilities(user).filter(pk=facility.pk).exists()


def scope_facility(qs, user, facility_field="facility"):
    """Filter a queryset to facilities the user belongs to (SAD §5)."""
    if not getattr(user, "is_authenticated", False):
        return qs.none()
    profile = getattr(user, "profile", None)
    if profile is None:
        return qs.none()
    fids = list(profile.facilities.values_list("id", flat=True))
    if not fids:
        return qs.none()
    return qs.filter(**{f"{facility_field}__in": fids})


VALID_STATUS_TRANSITIONS = {
    "inquiry": ["quoted", "cancelled"],
    "quoted": ["confirmed", "cancelled"],
    "confirmed": ["assigned", "cancelled"],
    "assigned": ["dispatched", "cancelled"],
    "dispatched": ["at_border", "cancelled"],
    "at_border": ["in_transit", "cancelled"],
    "in_transit": ["delivered", "cancelled"],
    "delivered": ["paid"],
    "paid": [],
    "cancelled": [],
}


def validate_status_transition(old_status, new_status):
    """Return True if the status transition is valid."""
    allowed = VALID_STATUS_TRANSITIONS.get(old_status, [])
    return new_status in allowed


class IsAdmin(BasePermission):
    """ADMIN role only (replaces the is_staff shortcut — SAD §5)."""

    def has_permission(self, request, view):
        return get_user_role(request.user) == UserRole.ADMIN


class IsOwnerOrReadOnly(BasePermission):
    """ADMIN role full access; other authenticated roles read-only."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return get_user_role(request.user) == UserRole.ADMIN


class IsInOrganisation(BasePermission):
    """Allow access only if user belongs to the same org as the object."""

    def has_object_permission(self, request, view, obj):
        return belongs_to_organisation(obj, request.user)
