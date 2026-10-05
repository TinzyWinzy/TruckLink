"""Restricted rule schema v1 and deterministic evaluator; no Django/HTTP/LLM.

Masses are kilograms represented as decimal strings in persisted snapshots.
Dates are UTC ISO timestamps/date strings supplied by the orchestration layer.
No money, penalty schedule or bundled legal thresholds exist here.
"""
import hashlib
import json
from decimal import Decimal, InvalidOperation

ENGINE_VERSION = 'nrok-1'
DECISIONS = ('PASS', 'PASS_WITH_WARNINGS', 'HOLD', 'QUARANTINE', 'REVIEW_REQUIRED')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def mass(value):
    if isinstance(value, bool):
        raise ValueError('Boolean mass is invalid')
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError('Mass must be decimal kilograms') from None
    if not number.is_finite() or number < 0 or number > Decimal('10000000'):
        raise ValueError('Mass must be finite, nonnegative kilograms within supported range')
    return number


def positive_masses(values):
    try:
        return isinstance(values, list) and bool(values) and all(mass(x) > 0 for x in values)
    except ValueError:
        return False


def validate_rule(rule):
    if not isinstance(rule, dict):
        raise ValueError('Rule definition must be an object')
    kind = rule.get('kind')
    required = {'kind', 'applicability', 'failure_action', 'override_policy'}
    extra = {'AXLE_MAX': {'limits_kg'}, 'GROSS_MAX': {'limit_kg'},
             'EVIDENCE': {'evidence_kind', 'subject'}, 'CHECKLIST': {'item_id'}}
    if kind not in extra or set(rule) != required | extra[kind]:
        raise ValueError('Unsupported rule kind or fields; schema v1 is explicit')
    if rule['failure_action'] not in ('HOLD', 'QUARANTINE', 'PASS_WITH_WARNINGS') or rule['override_policy'] not in ('NOT_ALLOWED', 'INDEPENDENT_APPROVAL'):
        raise ValueError('Unknown failure action or override policy')
    applicability = rule['applicability']
    if not isinstance(applicability, dict) or any(k not in ('vehicle_class', 'cargo_class') or not isinstance(v, list) or not v or any(not isinstance(x, str) or not x.strip() for x in v) for k, v in applicability.items()):
        raise ValueError('Applicability supports explicit vehicle_class/cargo_class sets')
    if kind == 'AXLE_MAX' and not positive_masses(rule['limits_kg']):
        raise ValueError('Axle limits must be positive decimal kilograms')
    if kind == 'GROSS_MAX' and mass(rule['limit_kg']) <= 0:
        raise ValueError('Gross limit must be positive kilograms')
    if kind == 'EVIDENCE' and (rule['subject'] not in ('vehicle', 'driver', 'trip', 'load') or not isinstance(rule['evidence_kind'], str) or not rule['evidence_kind'].strip()):
        raise ValueError('Evidence requires a kind and an entity subject')
    if kind == 'CHECKLIST' and (not isinstance(rule['item_id'], str) or not rule['item_id'].strip()):
        raise ValueError('Checklist item id required')


def evaluate(bundles, context, inputs):
    weights = inputs['axle_weights']
    if not isinstance(weights, list) or not weights:
        raise ValueError('Measured axles required')
    weights = [mass(x) for x in weights]
    total = mass(inputs['total_weight'])
    checks = inputs.get('checklist_results', {})
    if not isinstance(checks, dict):
        raise ValueError('Checklist must be an object')
    controls = []

    def add(key, passed, reason, *, expected=None, measured=None, failure='QUARANTINE', override='NOT_ALLOWED', provenance=None):
        controls.append({'id': key, 'status': 'PASS' if passed else failure,
                         'reason': reason, 'expected': expected, 'measured': measured,
                         'override_policy': override, 'provenance': provenance})

    rated = [mass(x) for x in context['rated_axle_kg']]
    add('vehicle.axles', len(weights) == len(rated) and all(w <= r for w, r in zip(weights, rated)),
        'Measured axles compared with independently evidenced manufacturer ratings',
        expected=context['rated_axle_kg'], measured=[str(w) for w in weights])
    add('vehicle.gross', total <= mass(context['rated_gross_kg']),
        'Measured gross compared with evidenced vehicle rating', expected=context['rated_gross_kg'], measured=str(total))
    add('measurement.consistency', abs(sum(weights) - total) <= Decimal('1'),
        'Total must match axle sum within 1 kg capture tolerance; operational policy gate-1',
        expected=str(sum(weights)), measured=str(total), failure='HOLD')
    for bundle in bundles:
        first_control = len(controls)
        for unit in bundle['content']['units']:
            rule = unit['definition']
            validate_rule(rule)
            key = f"{bundle['id']}:{unit['id']}"
            provenance = {'ruleset_id': bundle['id'], 'digest': bundle['digest'],
                          'unit_id': unit['id'], 'revision': unit['revision'], 'source': unit['source']}
            if any(context.get(k) not in allowed for k, allowed in rule['applicability'].items()):
                controls.append({'id': key, 'status': 'NOT_APPLICABLE', 'reason': 'Context outside explicit applicability', 'provenance': provenance})
                continue
            kind = rule['kind']
            expected, measured = None, None
            if kind == 'AXLE_MAX':
                limits = [mass(x) for x in rule['limits_kg']]
                # A malformed/incompatible configuration is never overrideable.
                if len(weights) != len(limits):
                    add(key, False, 'Ruleset axle layout does not match configured vehicle', failure='REVIEW_REQUIRED', provenance=provenance)
                    continue
                passed = all(w <= limit for w, limit in zip(weights, limits))
                expected, measured = rule['limits_kg'], [str(w) for w in weights]
            elif kind == 'GROSS_MAX':
                passed = total <= mass(rule['limit_kg'])
                expected, measured = rule['limit_kg'], str(total)
            elif kind == 'EVIDENCE':
                passed = any(e['kind'] == rule['evidence_kind'] and e['subject'] == rule['subject'] and e['usable'] for e in context['evidence'])
                expected = {'kind': rule['evidence_kind'], 'subject': rule['subject'], 'verified_and_current': True}
            else:
                passed = checks.get(rule['item_id']) is True
                expected, measured = True, checks.get(rule['item_id'])
            # Missing evidence/attestations cannot become a mass override.
            add(key, passed, f'{kind} requirement evaluated', expected=expected, measured=measured,
                failure='HOLD' if kind in ('EVIDENCE', 'CHECKLIST') and rule['failure_action'] != 'PASS_WITH_WARNINGS' else rule['failure_action'],
                override='NOT_ALLOWED' if kind in ('EVIDENCE', 'CHECKLIST') else rule['override_policy'], provenance=provenance)
        if not any(c['status'] != 'NOT_APPLICABLE' for c in controls[first_control:]):
            add(f"configuration.applicability:{bundle['id']}", False,
                'No control applies in this jurisdiction; review applicability', failure='REVIEW_REQUIRED')
    active = [c for c in controls if c['status'] != 'NOT_APPLICABLE']
    # A bundle that applies no regulatory control cannot authorize release.
    if not any(c.get('provenance') for c in active):
        add('configuration.applicability', False, 'No published control applies to this vehicle/load', failure='REVIEW_REQUIRED')
        active = [c for c in controls if c['status'] != 'NOT_APPLICABLE']
    statuses = {c['status'] for c in active}
    decision = next((d for d in ('REVIEW_REQUIRED', 'QUARANTINE', 'HOLD', 'PASS_WITH_WARNINGS') if d in statuses), 'PASS')
    blockers = [c for c in active if c['status'] not in ('PASS', 'PASS_WITH_WARNINGS')]
    return {'decision': decision, 'controls': controls,
            'readiness_percent': round(100 * sum(c['status'] == 'PASS' for c in active) / len(active), 2),
            'readiness_policy': 'equal-control-weight-v1',
            'override_eligible': bool(blockers) and all(c['override_policy'] == 'INDEPENDENT_APPROVAL' for c in blockers),
            'engine_version': ENGINE_VERSION, 'monetary_penalty': None}
