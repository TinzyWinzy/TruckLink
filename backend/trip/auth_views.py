"""Auth endpoints: register, login, pin login, logout, me."""
from django.contrib.auth import authenticate
from django.db import transaction
from django.contrib.auth.hashers import check_password
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import PinCredential, AdminRoleSelection
from core.throttling import CredentialAttemptThrottle, CredentialIPThrottle

from .serializers import RegisterSerializer, LoginSerializer, UserSerializer


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([CredentialAttemptThrottle, CredentialIPThrottle])
@transaction.atomic
def register(request):
    serializer = RegisterSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(
            {"ok": False, "errors": serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    result = serializer.save()
    return Response(
        {
            "ok": True,
            "token": result["token"].key,
            "user": UserSerializer(result["user"]).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([CredentialAttemptThrottle, CredentialIPThrottle])
def login_view(request):
    serializer = LoginSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(
            {"ok": False, "errors": serializer.errors},
            status=status.HTTP_400_BAD_REQUEST,
        )
    user = authenticate(
        username=serializer.validated_data["username"],
        password=serializer.validated_data["password"],
    )
    if user is None:
        return Response(
            {"ok": False, "error": "invalid credentials"},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    token, _ = Token.objects.get_or_create(user=user)
    AdminRoleSelection.objects.filter(token=token).delete()
    return Response({
        "ok": True,
        "token": token.key,
        "user": UserSerializer(user).data,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    Token.objects.filter(user=request.user).delete()
    return Response({"ok": True})


_PIN_FAILURE = {"ok": False, "error": "invalid credentials"}


def _normalize_staff_id(raw: str) -> str:
    v = raw.strip().upper()
    if v and not v.startswith("TRK-"):
        v = f"TRK-{v}"
    return v


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([CredentialAttemptThrottle, CredentialIPThrottle])
def pin_login(request):
    """POST /api/auth/pin/ — exchange TRK-<staff-id> + PIN for a token (SAD §5).

    Fail-closed: unknown/inactive credential, bad PIN, or a credential with no
    provisioned user (synthetic user creation is admin-only) all return the
    same 401 — no oracle for enumeration.
    """
    staff_id = _normalize_staff_id(str(request.data.get("staff_id", "")))
    pin = str(request.data.get("pin", "")).strip()
    if not staff_id or not pin:
        return Response(_PIN_FAILURE, status=status.HTTP_401_UNAUTHORIZED)

    cred = PinCredential.objects.select_related("user").filter(
        staff_id=staff_id, is_active=True,
    ).first()
    if cred is None or not check_password(pin, cred.pin_hash):
        return Response(_PIN_FAILURE, status=status.HTTP_401_UNAUTHORIZED)
    user = cred.user
    if user is None or not user.is_active:
        return Response(_PIN_FAILURE, status=status.HTTP_401_UNAUTHORIZED)

    token, _ = Token.objects.get_or_create(user=user)
    AdminRoleSelection.objects.filter(token=token).delete()
    return Response({"ok": True, "token": token.key, "user": UserSerializer(user).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response({
        "ok": True,
        "user": UserSerializer(request.user).data,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def switch_role(request):
    """Only assigned ADMIN accounts may select a working role; identity stays fixed."""
    from trip.models import UserRole
    from core.audit import append_audit
    profile = getattr(request.user, 'profile', None)
    if not profile or profile.role != UserRole.ADMIN or not profile.organisation_id:
        return Response({'ok': False, 'error': 'Only an assigned administrator may switch roles.'}, status=403)
    if not isinstance(request.auth, Token):
        return Response({'ok': False, 'error': 'Token sign-in required.'}, status=403)
    role = str(request.data.get('role', ''))
    if role not in UserRole.values:
        return Response({'ok': False, 'error': 'Unknown role.'}, status=400)
    token = Token.objects.select_for_update().get(pk=request.auth.pk)
    from trip.permissions import get_user_role
    previous = get_user_role(request.user)
    for facility in profile.facilities.filter(is_deleted=False, organisation_id=profile.organisation_id):
        append_audit(facility=facility, action='ADMIN_ROLE_SWITCH', actor=request.user,
                     payload={'from_role': previous, 'to_role': role, 'base_role': UserRole.ADMIN})
    AdminRoleSelection.objects.update_or_create(token=token, defaults={'role': role})
    request.user._working_role = role
    return Response({'ok': True, 'user': UserSerializer(request.user).data})
