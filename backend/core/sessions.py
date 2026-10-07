"""Bounded renewable sessions, compatible with the existing Token API."""
import hashlib
import secrets
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework.authtoken.models import Token
from .models import RefreshSession, AdminRoleSelection, PinCredential

ACCESS_LIFETIME = timedelta(minutes=30)
REFRESH_LIFETIME = timedelta(days=30)


def fingerprint(user):
    pins = list(PinCredential.objects.filter(user=user).order_by('pk').values_list('pin_hash', 'is_active'))
    return hashlib.sha256(f'{user.password}:{pins}'.encode()).hexdigest()


def issue_session(user):
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=user.pk)
        token, _ = Token.objects.get_or_create(user=user)
        token.created = timezone.now()
        token.save(update_fields=['created'])
        AdminRoleSelection.objects.filter(token=token).delete()
        secret = secrets.token_urlsafe(48)
        RefreshSession.objects.filter(user=user, expires_at__lte=timezone.now()).delete()
        RefreshSession.objects.create(user=user, secret_hash=hashlib.sha256(secret.encode()).hexdigest(),
            credential_hash=fingerprint(user), expires_at=timezone.now() + REFRESH_LIFETIME)
        return {'token': token.key, 'refresh_token': secret, 'expires_in': int(ACCESS_LIFETIME.total_seconds())}


@transaction.atomic
def renew_session(secret):
    if not isinstance(secret, str) or not 32 <= len(secret) <= 128:
        return None
    session = RefreshSession.objects.filter(secret_hash=hashlib.sha256(secret.encode()).hexdigest()).first()
    if not session:
        return None
    user = get_user_model().objects.select_for_update().get(pk=session.user_id)
    # Recheck after the user lock so a concurrent logout cannot revive a session.
    session = RefreshSession.objects.filter(pk=session.pk, expires_at__gt=timezone.now()).first()
    if not session or not user.is_active or session.credential_hash != fingerprint(user):
        return None
    old = Token.objects.filter(user=user).first()
    if not old:  # Explicit revocation must not be undone by refresh.
        return None
    selection = AdminRoleSelection.objects.filter(token=old).first()
    role = selection.role if selection else None
    old.delete()
    token = Token.objects.create(user=user)
    if role:
        AdminRoleSelection.objects.create(token=token, role=role)
        user._working_role = role
    return user, {'token': token.key, 'expires_in': int(ACCESS_LIFETIME.total_seconds())}
