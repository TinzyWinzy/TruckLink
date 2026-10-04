"""Auth endpoints: register, login, pin login, logout, me."""
from django.contrib.auth import authenticate
from django.contrib.auth.hashers import check_password
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import PinCredential

from .serializers import RegisterSerializer, LoginSerializer, UserSerializer


@api_view(["POST"])
@permission_classes([AllowAny])
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
    return Response({"ok": True, "token": token.key, "user": UserSerializer(user).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response({
        "ok": True,
        "user": UserSerializer(request.user).data,
    })
