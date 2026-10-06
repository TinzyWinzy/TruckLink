"""Tenant bindings select operator-managed secrets; config never stores credentials."""
import os
from django.conf import settings
from .configuration import resolved


def credential(organisation, provider, suffix):
    binding = resolved(organisation)['content']['integrations'].get('notifications',{}).get(provider)
    if not binding or not binding['enabled']:
        return ''
    key = f"{binding['env_prefix']}_{suffix}"
    return os.environ.get(key, getattr(settings,key,''))
