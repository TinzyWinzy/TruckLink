"""Deterministic synthetic fixtures. No operational records or legal assertions."""
import copy
import random
from regulatory.engine.evaluator import digest
from regulatory.services import evaluate_inspection
from compliance.policy import MANDATORY_CHECKLIST_IDS

# Invented first-order Markov chains over synthetic situations. Rows are
# internal fixtures only — they encode no claim about real conditional
# probabilities at any facility.
DECISION_INITIAL_DISTRIBUTION = {
    'clear': 0.60, 'checks': 0.12, 'overload': 0.10, 'rating': 0.06,
    'measurement': 0.05, 'rules': 0.04, 'evidence': 0.03,
}
DECISION_TRANSITIONS = {
    'clear': {'clear': 0.78, 'checks': 0.08, 'measurement': 0.04, 'overload': 0.04,
              'rating': 0.03, 'rules': 0.02, 'evidence': 0.01},
    'checks': {'checks': 0.35, 'clear': 0.45, 'rules': 0.08, 'evidence': 0.05,
               'measurement': 0.05, 'overload': 0.02},
    'measurement': {'measurement': 0.30, 'clear': 0.55, 'checks': 0.10, 'rules': 0.05},
    'overload': {'overload': 0.40, 'clear': 0.35, 'rating': 0.15, 'checks': 0.05, 'rules': 0.05},
    'rating': {'rating': 0.45, 'overload': 0.20, 'clear': 0.25, 'checks': 0.05, 'rules': 0.05},
    'rules': {'rules': 0.30, 'clear': 0.50, 'checks': 0.10, 'measurement': 0.05, 'evidence': 0.05},
    'evidence': {'evidence': 0.25, 'clear': 0.60, 'checks': 0.10, 'rules': 0.05},
}
# HOLD situations may re-present once; only a clearing recheck reaches service.
RECHECK_TRANSITIONS = {
    'checks': {'clear': 0.70, 'checks': 0.25, 'rules': 0.05},
    'measurement': {'clear': 0.75, 'measurement': 0.20, 'rules': 0.05},
    'evidence': {'clear': 0.55, 'evidence': 0.40, 'rules': 0.05},
}
RECHECK_DELAY_MINUTES = (20.0, 50.0)


def run_model(*, seed=42, vehicles=72, docks=3, arrivals_per_hour=18, service_minutes=12):
    rng = random.Random(seed)
    source = {'title': 'Invented modelling policy', 'kind': 'INTERNAL_POLICY',
              'document_ref': 'synthetic://modelling-v1', 'effective_from': '2026-01-01',
              'effective_to': '2099-12-31', 'verified_law': False}
    definition = {'kind': 'GROSS_MAX', 'limit_kg': '24000', 'applicability': {},
                  'failure_action': 'QUARANTINE', 'override_policy': 'INDEPENDENT_APPROVAL'}
    content = {'units': [{'id': 'synthetic-gross', 'revision': 1, 'source': source, 'definition': definition}]}
    bundles = [{'id': 'synthetic-v1', 'digest': digest(content), 'content': content}]
    context = {'rated_axle_kg': ['12000'] * 3, 'rated_gross_kg': '36000',
               'vehicle_class': 'SYNTHETIC_TRUCK', 'cargo_class': 'GENERAL', 'evidence': []}
    inputs = {'axle_weights': ['6000', '8000', '8000'], 'total_weight': '22000',
              'checklist_results': dict.fromkeys(MANDATORY_CHECKLIST_IDS, True)}
    scenarios = []
    def case(key, title, expected, changes=None, empty_rules=False):
        data = copy.deepcopy(inputs); data.update(changes or {})
        result = evaluate_inspection([] if empty_rules else bundles, copy.deepcopy(context), data)
        scenarios.append({'id': key, 'title': title, 'expected': expected,
                          'matches_expected': result['decision'] == expected,
                          'inputs': data, 'ruleset_snapshot': [] if empty_rules else copy.deepcopy(bundles), 'context_snapshot': copy.deepcopy(context), 'result': result})
    case('clear', 'Complete evidence and load within synthetic limits', 'PASS')
    case('overload', 'Invented policy gross limit exceeded', 'QUARANTINE',
         {'axle_weights': ['9000','8000','8000'], 'total_weight':'25000'})
    case('rating', 'Synthetic manufacturer axle rating exceeded', 'QUARANTINE',
         {'axle_weights':['13000','8000','8000'], 'total_weight':'29000'})
    case('checks', 'Required inspection attestation missing', 'HOLD', {'checklist_results': {}})
    case('measurement', 'Gross reading disagrees with axle sum', 'HOLD', {'total_weight':'23000'})
    case('rules', 'No applicable versioned controls available', 'REVIEW_REQUIRED', empty_rules=True)
    evidence_content = copy.deepcopy(content)
    evidence_content['units'].append({'id':'synthetic-permit','revision':1,'source':source,
        'definition':{'kind':'EVIDENCE','evidence_kind':'PERMIT','subject':'trip','applicability':{},
                      'failure_action':'HOLD','override_policy':'NOT_ALLOWED'}})
    evidence_bundle = [{'id':'synthetic-evidence-v1','digest':digest(evidence_content),'content':evidence_content}]
    missing = evaluate_inspection(evidence_bundle, copy.deepcopy(context), copy.deepcopy(inputs))
    scenarios.append({'id':'evidence','title':'Required synthetic trip permit absent', 'expected':'HOLD',
                      'matches_expected':missing['decision']=='HOLD','inputs':copy.deepcopy(inputs),'ruleset_snapshot':evidence_bundle,'context_snapshot':copy.deepcopy(context),'result':missing})
    order = [s['id'] for s in scenarios]
    available = [0.0] * docks
    arrival = last_time = busy = 0.0
    movements = []
    service_events = []
    recheck_specs = []
    current = rng.choices(order,
                          weights=[DECISION_INITIAL_DISTRIBUTION[k] for k in order])[0]
    for index in range(vehicles):
        arrival += rng.expovariate(arrivals_per_hour / 60)
        scenario = next(s for s in scenarios if s['id'] == current)
        result = scenario['result']
        row = {'reference': f'SYN-{index+1:04}', 'arrival_minutes': round(arrival, 2),
               'scenario': scenario['id'], 'decision': result['decision'],
               'override_eligible': result['override_eligible'], 'wait_minutes': None,
               'turnaround_minutes': None, 'dock': None}
        if result['decision'] == 'PASS':
            service_events.append({'arrival': arrival, 'seq': index, 'movement': row})
        elif result['decision'] == 'HOLD':
            recheck_time = arrival + rng.uniform(*RECHECK_DELAY_MINUTES)
            recheck_id = rng.choices(order, weights=[
                RECHECK_TRANSITIONS[current].get(k, 0.0) for k in order])[0]
            recheck_decision = next(s for s in scenarios if s['id'] == recheck_id)['result']['decision']
            recheck_specs.append((recheck_time, index, scenario['id'],
                                  recheck_id, recheck_decision))
        movements.append(row)
        last_time = arrival
        current = rng.choices(order, weights=[
            DECISION_TRANSITIONS[current].get(k, 0.0) for k in order])[0]
    # Build recheck rows after the primary chain pass; draw order stays fixed.
    rechecks = []
    for spec_index, (recheck_time, index, initial_id, recheck_id, decision) in enumerate(recheck_specs):
        row = {'reference': f'SYN-{index+1:04}-R1', 'arrival_minutes': round(recheck_time, 2),
               'scenario': f'{initial_id}-recheck', 'decision': decision,
               'override_eligible': False, 'wait_minutes': None,
               'turnaround_minutes': None, 'dock': None}
        if decision == 'PASS':
            service_events.append({'arrival': recheck_time, 'seq': 10000 + spec_index,
                                   'movement': row})
        rechecks.append(row)
        last_time = max(last_time, recheck_time)
    # One chronological scheduler pass covers initial and recheck service events.
    service_events.sort(key=lambda event: (event['arrival'], event['seq']))
    for event in service_events:
        bay = available.index(min(available))
        start = max(event['arrival'], available[bay])
        duration = rng.uniform(.8, 1.2) * service_minutes
        available[bay] = start + duration
        busy += duration
        event['movement'].update(dock=bay+1, wait_minutes=round(start-event['arrival'], 2),
                                 turnaround_minutes=round(start+duration-event['arrival'], 2))
    serviced = [r for r in movements if r['dock'] is not None] + \
               [r for r in rechecks if r['dock'] is not None]
    elapsed = max(last_time, *available)
    counts = {decision: sum(r['decision'] == decision for r in movements)
              for decision in sorted({r['decision'] for r in movements})}
    recheck_counts = {decision: sum(r['decision'] == decision for r in rechecks)
                      for decision in sorted({r['decision'] for r in rechecks})} if rechecks else {}
    report = {'synthetic': True, 'model_version': 'yard-synthetic-2',
              'assumptions': {'seed':seed, 'vehicles':vehicles, 'docks':docks,
                  'arrivals_per_hour':arrivals_per_hour, 'service_minutes':service_minutes,
                  'scenario_initial_distribution_percent':{k:100*v for k,v in DECISION_INITIAL_DISTRIBUTION.items()},
                  'scenario_transitions_percent':{k:{kk:100*vv for kk,vv in row.items()} for k,row in DECISION_TRANSITIONS.items()},
                  'recheck_transitions_percent':{k:{kk:100*vv for kk,vv in row.items()} for k,row in RECHECK_TRANSITIONS.items()},
                  'recheck_policy':'invented: synthetic HOLD situations re-present once 20 to 50 minutes later; only a clearing recheck enters modelled service',
                  'scenario_sampling':'seeded first-order Markov chain over invented transitions, not observed facility data',
                  'arrival_distribution':'exponential', 'service_distribution':'uniform 80% to 120% of mean',
                  'rating_review':'assumed synthetic fixture, not verified evidence',
                  'release_policy':'only PASS vehicles enter modelled service; vehicles that are quarantined, lack applicable rules or fail their recheck remain blocked'},
              'ruleset': bundles[0], 'scenarios':scenarios, 'movements':movements, 'rechecks':rechecks,
              'summary': {'modelled_serviced':len(serviced), 'blocked':vehicles-len(serviced),
                  'decisions':counts, 'recheck_decisions':recheck_counts,
                  'rechecks_attempted':len(rechecks), 'rechecks_serviced':len([r for r in rechecks if r['dock'] is not None]),
                  'average_wait_minutes':round(sum(r['wait_minutes'] for r in serviced)/len(serviced),2) if serviced else 0,
                  'average_turnaround_minutes':round(sum(r['turnaround_minutes'] for r in serviced)/len(serviced),2) if serviced else 0,
                  'dock_utilisation_percent':round(100*busy/(docks*elapsed),2),
                  'scenario_checks_passed':sum(s['matches_expected'] for s in scenarios)},
              'monetary_penalty':None, 'verified_law':False,
              'limitations':['Evaluation and capacity simulation only. No live inspection, approval or release is created.',
                             'Separate approvals and tenant isolation are validated in integration tests, not invented here.',
                             'The scenario transition matrices and recheck policy are invented fixtures, never observed or verified operational data.']}
    report['result_digest'] = digest(report)
    return report
