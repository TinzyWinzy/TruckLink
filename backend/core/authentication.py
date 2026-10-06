from rest_framework.authentication import TokenAuthentication
from trip.models import UserRole
from core.models import AdminRoleSelection


class WorkingRoleTokenAuthentication(TokenAuthentication):
    def authenticate_credentials(self, key):
        user, token = super().authenticate_credentials(key)
        profile = getattr(user, 'profile', None)
        if profile and profile.role == UserRole.ADMIN:
            selection = AdminRoleSelection.objects.filter(token=token).first()
            if selection:
                user._working_role = selection.role
        return user, token
