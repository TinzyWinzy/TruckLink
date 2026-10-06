"""Tenancy + credential provisioning endpoints (SAD v2 §5, §11)."""
from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.db import transaction
from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.authtoken.models import Token
from rest_framework.response import Response

from trip.models import Organisation, UserProfile, UserRole
from trip.permissions import IsAdmin, get_user_organisation

from .models import Facility, PinCredential, PushSubscription

User = get_user_model()


def _normalize_staff_id(raw: str) -> str:
    v = raw.strip().upper()
    if v and not v.startswith("TRK-"):
        v = f"TRK-{v}"
    return v


@api_view(["POST"])
@permission_classes([AllowAny])
def tenancy_signup(request):
    """POST /api/tenancy/signup/ — org + facility + ADMIN user in one transaction."""
    org_name = str(request.data.get("organisation_name", "")).strip()
    facility_name = str(request.data.get("facility_name", "")).strip() or "Main Yard"
    username = str(request.data.get("username", "")).strip()
    password = str(request.data.get("password", ""))
    email = str(request.data.get("email", "")).strip()
    facility_mode = str(request.data.get("facility_mode", "OPERATIONS"))

    errors = {}
    if facility_mode not in ("DEMO", "OPERATIONS"):
        errors["facility_mode"] = "must be DEMO or OPERATIONS"
    if not org_name:
        errors["organisation_name"] = "required"
    if not username:
        errors["username"] = "required"
    elif User.objects.filter(username=username).exists():
        errors["username"] = "already taken"
    if len(password) < 6:
        errors["password"] = "min length 6"
    if errors:
        return Response({"ok": False, "errors": errors}, status=status.HTTP_400_BAD_REQUEST)

    slug = slugify(org_name)[:100] or "org"
    if Organisation.objects.filter(slug=slug).exists():
        return Response(
            {"ok": False, "errors": {"organisation_name": "slug already exists"}},
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        org = Organisation.objects.create(name=org_name, slug=slug, requires_release=True)
        fac_slug = slugify(facility_name)[:100] or "yard"
        facility = Facility.objects.create(
            organisation=org, name=facility_name, slug=fac_slug,
            yard_config={"mode": facility_mode},
        )
        user = User.objects.create_user(
            username=username, password=password, email=email,
        )
        profile = UserProfile.objects.create(
            user=user, organisation=org, role=UserRole.ADMIN,
        )
        profile.facilities.add(facility)
        token, _ = Token.objects.get_or_create(user=user)

    return Response(
        {
            "ok": True,
            "token": token.key,
            "user": {"id": user.id, "username": username, "role": UserRole.ADMIN},
            "organisation": {"id": org.id, "name": org.name, "slug": org.slug},
            "facility": {"id": facility.id, "name": facility.name, "slug": facility.slug},
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([IsAdmin])
def provision_pin(request):
    """POST /api/admin/pins/ — ADMIN provisions a staff PIN credential.

    Synthetic user creation is admin-only (SAD §5): the user + profile are
    created here, at provision time — never at login time.
    """
    staff_id = _normalize_staff_id(str(request.data.get("staff_id", "")))
    pin = str(request.data.get("pin", ""))
    role = str(request.data.get("role", UserRole.OPERATIONS_SUPERVISOR))
    username = str(request.data.get("username", "")).strip() or staff_id
    facility_id = request.data.get("facility_id")

    errors = {}
    if not staff_id:
        errors["staff_id"] = "required"
    elif PinCredential.objects.filter(staff_id=staff_id).exists():
        errors["staff_id"] = "already provisioned"
    if len(pin) < 4:
        errors["pin"] = "min length 4"
    if role not in UserRole.values:
        errors["role"] = "unknown role"
    if User.objects.filter(username=username).exists():
        errors["username"] = "already taken"
    if errors:
        return Response({"ok": False, "errors": errors}, status=status.HTTP_400_BAD_REQUEST)

    org = get_user_organisation(request.user)
    if org is None:
        return Response(
            {"ok": False, "error": "admin has no organisation"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    facility = None
    from tenancy.configuration import role_enabled
    if not role_enabled(org,role):
        return Response({'ok':False,'error':'Role is disabled for this tenant'},status=400)
    if facility_id:
        facility = Facility.objects.filter(pk=facility_id, organisation=org).first()
        if facility is None:
            return Response(
                {"ok": False, "errors": {"facility_id": "not in your organisation"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

    with transaction.atomic():
        user = User.objects.create_user(username=username)
        user.set_unusable_password()
        user.save()
        profile = UserProfile.objects.create(user=user, organisation=org, role=role)
        if facility is not None:
            profile.facilities.add(facility)
        cred = PinCredential.objects.create(
            staff_id=staff_id,
            pin_hash=make_password(pin),
            user=user,
            organisation=org,
            facility=facility,
        )

    return Response(
        {
            "ok": True,
            "pin": {"id": cred.id, "staff_id": cred.staff_id, "role": role},
            "user": {"id": user.id, "username": username},
        },
        status=status.HTTP_201_CREATED,
    )


# ---------------------------------------------------------------------------
# Web Push (SAD §10) — VAPID-native, Firebase-free.
# ---------------------------------------------------------------------------


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def push_public_key(request):
    """GET /api/push/public-key/ - the VAPID applicationServerKey for the PWA."""
    from tenancy.integrations import credential
    org = get_user_organisation(request.user)
    return Response({"public_key": credential(org,'webpush','PUBLIC_KEY') if org else ''})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def push_subscribe(request):
    """POST /api/push/subscribe/ - store this device's Web Push subscription."""
    endpoint = str(request.data.get("endpoint", "")).strip()
    keys = request.data.get("keys") or {}
    p256dh = str(keys.get("p256dh", "")).strip()
    auth = str(keys.get("auth", "")).strip()
    if not endpoint or not p256dh or not auth:
        return Response(
            {"ok": False, "error": "endpoint and keys.p256dh/keys.auth are required"},
            status=400,
        )
    profile = getattr(request.user, "profile", None)
    facility = profile.facilities.first() if profile else None
    sub, _created = PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={
            "user": request.user,
            "facility": facility,
            "p256dh": p256dh,
            "auth": auth,
        },
    )
    return Response({"ok": True, "id": sub.id})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def push_unsubscribe(request):
    """POST /api/push/unsubscribe/ - remove this device (own rows only)."""
    endpoint = str(request.data.get("endpoint", "")).strip()
    PushSubscription.objects.filter(endpoint=endpoint, user=request.user).delete()
    return Response({"ok": True})
