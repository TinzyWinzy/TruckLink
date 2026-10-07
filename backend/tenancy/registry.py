"""Versioned platform capabilities. Configuration selects supported behavior only."""
from django.core.exceptions import ValidationError
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from regulatory.engine.evaluator import validate_rule

MODULES = {
    'yard': [], 'docks': ['yard'], 'inspection': ['yard'], 'release': ['inspection'],
    'fleet': [], 'routing': ['fleet'], 'notifications': [], 'reports': [],
    'modelling': ['reports'], 'audit': [],
}
RESOURCE_MODULE = {'queue':'yard', 'docks':'docks', 'equipment':'docks',
    'compliance':'inspection', 'compliance_config':'inspection', 'regulatory':'inspection',
    'routes':'routing', 'reports':'reports', 'audit':'audit', 'alerts':'yard'}
ACTION_MODULE = {'CREATE_CONSIGNMENT':'routing', 'ALLOCATE_CONSIGNMENT':'routing', 'CREATE_QUEUE_ENTRY':'yard', 'ASSIGN_DOCK':'docks',
    'SUBMIT_COMPLIANCE':'inspection', 'EVALUATE_REGULATORY':'inspection',
    'REQUEST_OVERRIDE':'release', 'REQUEST_REGULATORY_OVERRIDE':'release',
    'DECIDE_REGULATORY_OVERRIDE':'release', 'APPROVE_OVERRIDE':'release',
    'REJECT_OVERRIDE':'release', 'RELEASE_VEHICLE':'release', 'SAVE_ROUTE_DRAFT':'routing'}
TRANSITIONS = {
    'UPDATE_QUEUE_STATUS':'update_status',
    'CREATE_QUEUE_ENTRY': 'arrival', 'ASSIGN_DOCK':'dock', 'SUBMIT_COMPLIANCE':'inspect',
    'EVALUATE_REGULATORY':'inspect', 'REQUEST_OVERRIDE':'request_override',
    'REQUEST_REGULATORY_OVERRIDE':'request_override', 'DECIDE_REGULATORY_OVERRIDE':'approve_override',
    'APPROVE_OVERRIDE':'approve_override', 'REJECT_OVERRIDE':'approve_override', 'RELEASE_VEHICLE':'release',
}
TEMPLATES = {'yard-lifecycle-v1': {'module':'yard', 'transitions':list(dict.fromkeys(TRANSITIONS.values())),
    'required_transitions':['arrival','inspect','release'], 'engine':'existing-authoritative-yard-services-v1'}}
ADAPTERS = {'twilio-v1': {'provider':'twilio'}, 'webpush-v1': {'provider':'webpush'},
            'road-routing-v1': {'provider':'routing'}}
KINDS = ('MODULES','WORKFLOW','SITE','PERMISSIONS','POLICY','PACK_ASSIGNMENT','INTEGRATION')


def exact(value, keys):
    if not isinstance(value,dict) or set(value) != set(keys):
        raise ValidationError('Configuration fields must match the supported schema')


def validate_artifact(row):
    from .configuration import defaults, validate
    from regulatory.knowledge import KnowledgeRevision
    c = row.content
    if row.facility_id and row.kind in ('MODULES','INTEGRATION'):
        raise ValidationError('Modules and provider credential bindings must be tenant-wide')
    if row.kind == 'MODULES':
        exact(c,MODULES)
        if any(type(v) is not bool for v in c.values()) or not c['audit']:
            raise ValidationError('Module enablement is boolean; audit is required')
        for module, dependencies in MODULES.items():
            if c[module] and any(not c[d] for d in dependencies):
                raise ValidationError(f'{module} requires its dependent modules')
    elif row.kind == 'WORKFLOW':
        exact(c,('template','transitions','workflow'))
        template = TEMPLATES.get(c['template'])
        transitions = c['transitions']
        if not template or not isinstance(transitions,list) or any(not isinstance(x,str) for x in transitions) or len(set(transitions)) != len(transitions) or not set(template['required_transitions']) <= set(transitions) <= set(template['transitions']):
            raise ValidationError('Choose supported workflow transitions, retaining safety-required steps')
        base = defaults(); base['workflow'] = c['workflow']; validate(base)
    elif row.kind == 'SITE':
        exact(c,('timezone','operating_parameters'))
        if not row.facility_id or not isinstance(c['operating_parameters'],dict):
            raise ValidationError('Site configuration requires an existing tenant site')
        if row.creator_id and (set(c['operating_parameters']) - {'mode'} or c['operating_parameters'].get('mode','OPERATIONS') not in ('DEMO','OPERATIONS')):
            raise ValidationError('Supported operating parameters are mode DEMO or OPERATIONS')
        if row.creator_id and c['operating_parameters'].get('mode') == 'DEMO' and row.facility.yard_config.get('mode','OPERATIONS') != 'DEMO':
            raise ValidationError('Operational sites cannot be downgraded to demo controls')
        try:
            ZoneInfo(c['timezone'])
        except (ZoneInfoNotFoundError,TypeError,ValueError):
            raise ValidationError('Supported site timezone required') from None
    elif row.kind == 'PERMISSIONS':
        exact(c,('grants',))
        base = defaults(); base['permissions'] = c['grants']; validate(base)
    elif row.kind == 'POLICY':
        exact(c,('classification','document_ref','document_sha256','controls'))
        if c['classification'] != 'TENANT_POLICY' or not isinstance(c['document_ref'],str) or not c['document_ref'].strip():
            raise ValidationError('Company procedures must be identified as TENANT_POLICY')
        fingerprint = c['document_sha256']
        if not isinstance(fingerprint,str) or len(fingerprint) != 64 or any(x not in '0123456789abcdef' for x in fingerprint):
            raise ValidationError('Internal policy document digest required')
        if not isinstance(c['controls'],list) or not c['controls']:
            raise ValidationError('Policy requires explicit supported controls')
        keys = []
        for control in c['controls']:
            exact(control,('key','definition'))
            if not isinstance(control['key'],str) or not control['key'].strip():
                raise ValidationError('Stable policy control key required')
            keys.append(control['key'])
            try:
                validate_rule(control['definition'])
            except ValueError as exc:
                raise ValidationError(str(exc)) from exc
            if control['definition']['override_policy'] != 'NOT_ALLOWED':
                raise ValidationError('Configurable tenant policy cannot introduce regulatory overrides')
        if len(set(keys)) != len(keys):
            raise ValidationError('Policy control keys must be unique')
    elif row.kind == 'PACK_ASSIGNMENT':
        exact(c,('pack_id','jurisdiction','route_type'))
        pack = KnowledgeRevision.objects.filter(pk=c['pack_id'],kind='PACK').first() if type(c['pack_id']) is int else None
        if not pack or pack.content['jurisdiction'] != c['jurisdiction'] or pack.content['route_type'] != c['route_type']:
            raise ValidationError('Assignment requires an exact matching platform pack')
    elif row.kind == 'INTEGRATION':
        exact(c,('adapter','enabled','env_prefix'))
        if c['adapter'] not in ADAPTERS or type(c['enabled']) is not bool:
            raise ValidationError('Choose an installed platform adapter')
        if c['adapter'] == 'road-routing-v1':
            if c['env_prefix'] != '':
                raise ValidationError('Road-routing adapter has no configurable credential prefix')
        else:
            base = defaults()
            base['integrations'] = {'notifications':{ADAPTERS[c['adapter']]['provider']:{'enabled':c['enabled'],'env_prefix':c['env_prefix']}}}
            validate(base)
    else:
        raise ValidationError('Unknown configuration kind')
