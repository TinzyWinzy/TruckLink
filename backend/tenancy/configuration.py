from copy import deepcopy
import re
from django.core.exceptions import ValidationError

CHECKS = ['driver-license', 'vehicle-reg', 'cargo-manifest', 'weight-cert', 'axle-calc']


def defaults():
    from trip.models import UserRole
    return {'schema_version': 1, 'branding': {'display_name': '', 'accent': '#2563eb', 'navy': '#101c30', 'paper': '#f4f6fa'},
            'roles': {role: {'label': str(label), 'enabled': True} for role, label in UserRole.choices},
            'permissions': {}, 'workflow': {'mandatory_checks': list(CHECKS), 'inspection_max_age_seconds': 86400,
                                         'escalation_minutes': {'FM': 10, 'EXEC': 30}}, 'integrations': {}}


def validate(content):
    from trip.models import UserRole
    from core.rbac import ROLE_MATRIX
    base = defaults()
    if not isinstance(content, dict) or set(content) != set(base) or content['schema_version'] != 1:
        raise ValidationError('Tenant configuration requires the complete schema version 1 document')
    brand = content['branding']
    if not isinstance(brand, dict) or set(brand) != set(base['branding']) or not isinstance(brand['display_name'], str) or len(brand['display_name']) > 200:
        raise ValidationError('Invalid tenant branding')
    if any(not isinstance(brand[key], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', brand[key]) for key in ('accent','navy','paper')):
        raise ValidationError('Brand colors must be six-digit hex values')
    roles = content['roles']
    if not isinstance(roles, dict) or set(roles) != set(UserRole.values):
        raise ValidationError('Configure labels and enablement for each platform role')
    for value in roles.values():
        if not isinstance(value, dict) or set(value) != {'label','enabled'} or type(value['enabled']) is not bool or not isinstance(value['label'],str) or not 1 <= len(value['label'].strip()) <= 100:
            raise ValidationError('Invalid role configuration')
    if not roles['ADMIN']['enabled']:
        raise ValidationError('Tenant administrator access cannot be disabled')
    grants = content['permissions']
    if not isinstance(grants, dict):
        raise ValidationError('Permissions must be a resource.action map')
    for key, allowed in grants.items():
        scope = tuple(key.split('.'))
        if scope not in ROLE_MATRIX or not isinstance(allowed, list) or any(not isinstance(role,str) for role in allowed) or not set(allowed) <= ROLE_MATRIX[scope] or len(set(allowed)) != len(allowed):
            raise ValidationError('Tenant permissions may narrow platform capability ceilings only')
        if scope[0] == 'admin' and 'ADMIN' not in allowed:
            raise ValidationError('Tenant administrator access cannot be removed')
    flow = content['workflow']
    if not isinstance(flow, dict) or set(flow) != set(base['workflow']):
        raise ValidationError('Invalid workflow configuration')
    checks = flow['mandatory_checks']
    if not isinstance(checks, list) or not checks or len(checks) > 30 or any(not isinstance(c,str) or not re.fullmatch(r'[a-z][a-z0-9-]{1,63}',c) for c in checks) or len(set(checks)) != len(checks):
        raise ValidationError('Mandatory checks require distinct stable identifiers')
    if type(flow['inspection_max_age_seconds']) is not int or not 1 <= flow['inspection_max_age_seconds'] <= 86400:
        raise ValidationError('Invalid inspection freshness limit')
    windows = flow['escalation_minutes']
    if not isinstance(windows, dict) or set(windows) != {'FM','EXEC'} or any(type(x) is not int or x < 1 or x > 10080 for x in windows.values()) or windows['EXEC'] < windows['FM']:
        raise ValidationError('Invalid escalation windows')
    bindings = content['integrations']
    if not isinstance(bindings, dict) or set(bindings) - {'notifications'}:
        raise ValidationError('Unknown integration binding')
    if not isinstance(bindings.get('notifications',{}),dict):
        raise ValidationError('Notification bindings must be a provider map')
    for channel, binding in bindings.get('notifications', {}).items():
        if channel not in ('twilio','webpush') or not isinstance(binding, dict) or set(binding) != {'enabled','env_prefix'} or type(binding['enabled']) is not bool or not isinstance(binding['env_prefix'],str) or not re.fullmatch(r'[A-Z][A-Z0-9_]{1,63}',binding['env_prefix']):
            raise ValidationError('Integration bindings use environment prefixes, never secret values')


def resolved(organisation, at=None, facility=None):
    from django.utils import timezone
    from .models import TenantConfiguration
    row = TenantConfiguration.objects.filter(organisation=organisation, effective_from__lte=at or timezone.now()).order_by('-version').first()
    content = deepcopy(row.content) if row else defaults()
    if not row and not content['branding']['display_name']:
        content['branding']['display_name'] = organisation.name
    from .releases import active_release,release_config
    release = active_release(organisation,at)
    if release:
        content = release_config(release,facility,at)
        row = release.configuration
    from .subscriptions import entitlement, effective_modules, configured_modules
    modules = effective_modules(organisation,at)
    from regulatory.engine.evaluator import digest
    return {'id':row.pk if row else None,'version': row.version if row else 0, 'digest': row.digest if row else '', 'content': content,
        'effective_digest':digest(content),
        'modules':modules,'configured_modules':configured_modules(organisation,at),'subscription':entitlement(organisation,at),
        'release':{'id':release.pk,'version':release.version,'digest':release.digest} if release else None}


def role_enabled(organisation, role):
    return bool(role and resolved(organisation)['content']['roles'].get(role,{}).get('enabled'))


def workflow(organisation, facility=None):
    from regulatory.engine.evaluator import digest
    config = resolved(organisation,facility=facility)
    flow = config['content']['workflow']
    return {**flow, 'version': config['version'], 'digest': digest(flow)}
