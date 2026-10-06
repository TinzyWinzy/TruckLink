"""Separate operational polling from credential attempt budgets."""
import hashlib
from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle


class OperationalUserThrottle(UserRateThrottle):
    scope = 'operational_user'


class CredentialAttemptThrottle(SimpleRateThrottle):
    scope = 'credential_attempt'

    def get_cache_key(self, request, view):
        if 'staff_id' in request.data:
            identity = str(request.data.get('staff_id', '')).strip().upper()
            if not identity.startswith('TRK-'):
                identity = f'TRK-{identity}'
            identity = f'pin:{identity}'
        else:
            identity = f"login:{str(request.data.get('username', request.data.get('email', ''))).strip().casefold()}"
        ident = hashlib.sha256(identity.encode()).hexdigest()
        return self.cache_format % {'scope': self.scope, 'ident': ident}


class CredentialIPThrottle(SimpleRateThrottle):
    scope = 'credential_ip'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}
