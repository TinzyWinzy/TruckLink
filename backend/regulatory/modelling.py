"""Deterministic synthetic fixtures. No operational records or legal assertions."""
import copy
import random
from regulatory.engine.evaluator import digest
from regulatory.services import evaluate_inspection
from compliance.policy import MANDATORY_CHECKLIST_IDS


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
    available = [0.0] * docks
    arrival = busy = 0.0
    movements = []
    for index in range(vehicles):
        arrival += rng.expovariate(arrivals_per_hour / 60)
        scenario = rng.choices(scenarios, weights=[60,12,5,8,5,5,5])[0]
        result = scenario['result']
        row = {'reference': f'SYN-{index+1:04}', 'arrival_minutes': round(arrival,2),
               'scenario': scenario['id'], 'decision': result['decision'],
               'override_eligible': result['override_eligible'], 'wait_minutes': None,
               'turnaround_minutes': None, 'dock': None}
        if result['decision'] == 'PASS':
            bay = available.index(min(available))
            start = max(arrival, available[bay]); duration = rng.uniform(.8,1.2)*service_minutes
            available[bay] = start + duration; busy += duration
            row.update(dock=bay+1, wait_minutes=round(start-arrival,2),
                       turnaround_minutes=round(start+duration-arrival,2))
        movements.append(row)
    completed = [r for r in movements if r['turnaround_minutes'] is not None]
    elapsed = max(arrival, *available)
    counts = {decision: sum(r['decision'] == decision for r in movements)
              for decision in sorted({r['decision'] for r in movements})}
    report = {'synthetic': True, 'model_version': 'yard-synthetic-1',
              'assumptions': {'seed':seed, 'vehicles':vehicles, 'docks':docks,
                  'arrivals_per_hour':arrivals_per_hour, 'service_minutes':service_minutes,
                  'scenario_weights_percent':[60,12,5,8,5,5,5],
                  'arrival_distribution':'exponential', 'service_distribution':'uniform 80% to 120% of mean',
                  'rating_review':'assumed synthetic fixture, not verified evidence',
                  'release_policy':'only PASS vehicles enter modelled service; blocked vehicles remain blocked'},
              'ruleset': bundles[0], 'scenarios':scenarios, 'movements':movements,
              'summary': {'modelled_serviced':len(completed), 'blocked':vehicles-len(completed),
                  'decisions':counts, 'average_wait_minutes':round(sum(r['wait_minutes'] for r in completed)/len(completed),2) if completed else 0,
                  'average_turnaround_minutes':round(sum(r['turnaround_minutes'] for r in completed)/len(completed),2) if completed else 0,
                  'dock_utilisation_percent':round(100*busy/(docks*elapsed),2),
                  'scenario_checks_passed':sum(s['matches_expected'] for s in scenarios)},
              'monetary_penalty':None, 'verified_law':False,
              'limitations':['Evaluation and capacity simulation only. No live inspection, approval or release is created.',
                            'Separate approvals and tenant isolation are validated in integration tests, not invented here.']}
    report['result_digest'] = digest(report)
    return report
