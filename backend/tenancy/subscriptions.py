"""Commercial entitlement, configured capability and readiness remain separate decisions."""
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from .catalogue import dependencies, expand_modules
from .registry import MODULES
from .models import TenantEntitlementVersion


def entitlement(org, at=None):
    now = at or timezone.now()
    row = TenantEntitlementVersion.objects.filter(organisation=org,effective_from__lte=now).order_by('-version').first()
    if row:
        state = 'EXPIRED' if row.effective_to and now >= row.effective_to else row.state
        modules = row.modules if state == 'ACTIVE' else ['audit']
        return {'version':row.version,'state':state,'basis':row.basis,'modules':modules,
            'effective_from':row.effective_from.isoformat(),'effective_to':row.effective_to.isoformat() if row.effective_to else None}
    # Explicit pre-release compatibility flag; new onboarding always requires_release=True.
    legacy = not org.requires_release
    return {'version':0,'state':'LEGACY_COMPATIBILITY' if legacy else 'UNASSIGNED',
        'basis':'LEGACY_CONTINUITY' if legacy else None,'modules':sorted(MODULES) if legacy else ['audit'],
        'effective_from':None,'effective_to':None}


def configured_modules(org, at=None):
    from .releases import active_release, artifacts
    release = active_release(org,at)
    if release:
        rows = artifacts(release,kind='MODULES',at=at)
        return {key:bool(rows and rows[0].content.get(key,False)) for key in MODULES}
    return {key:key == 'audit' or not org.requires_release for key in MODULES}


def effective_modules(org, at=None):
    configured = configured_modules(org,at)
    granted = set(entitlement(org,at)['modules'])
    active = {key for key in MODULES if configured[key] and key in granted} | {'audit'}
    while True:
        narrowed = {key for key in active if set(dependencies(key)) <= active}
        if narrowed == active:
            return {key:key in active for key in MODULES}
        active = narrowed


@transaction.atomic
def issue_entitlement(actor, org, modules, expected_version, reason, basis='CONTRACT', state='ACTIVE', effective_from=None, effective_to=None):
    from trip.models import Organisation
    if not actor.is_active or not actor.is_superuser:
        raise PermissionError('Platform operator required; tenant administrators cannot grant subscriptions')
    Organisation.objects.select_for_update().get(pk=org.pk)
    latest = TenantEntitlementVersion.objects.filter(organisation=org).order_by('-version').first()
    if type(expected_version) is not int or expected_version != (latest.version if latest else 0):
        raise ValidationError('Entitlement changed; refresh before issuing a revision')
    if basis not in ('CONTRACT','TRIAL'):
        raise ValidationError('A new grant requires an approved contract or trial basis')
    row = TenantEntitlementVersion.objects.create(organisation=org,version=expected_version+1,
        creator=actor,modules=expand_modules(modules),state=state,basis=basis,reason=reason,
        effective_from=effective_from or timezone.now(),effective_to=effective_to)
    from core.audit import append_audit
    for site in org.facilities.filter(is_deleted=False):
        append_audit(facility=site,actor=actor,action='ISSUE_TENANT_ENTITLEMENT',payload={
            'entitlement_id':row.pk,'version':row.version,'modules':row.modules,'state':row.state,'basis':row.basis,'reason':reason,
            'previous_state':latest.state if latest else None,'new_state':row.state,
            'effective_from':row.effective_from.isoformat(),'effective_to':row.effective_to.isoformat() if row.effective_to else None})
    return row
