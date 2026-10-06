"""Tenant bindings select operator-managed secrets; config never stores credentials."""
import os
from django.conf import settings
from .configuration import resolved


def adapter_enabled(organisation,adapter):
    from .releases import active_release,artifacts
    release = active_release(organisation)
    rows = [r for r in artifacts(release,kind='INTEGRATION') if r.content['adapter'] == adapter] if release else []
    return all(r.content['enabled'] for r in rows)


def credential(organisation, provider, suffix):
    from .releases import module_enabled
    if not module_enabled(organisation,'notifications'):
        return ''
    binding = resolved(organisation)['content']['integrations'].get('notifications',{}).get(provider)
    if not binding or not binding['enabled']:
        return ''
    key = f"{binding['env_prefix']}_{suffix}"
    return os.environ.get(key, getattr(settings,key,''))
