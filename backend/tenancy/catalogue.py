"""Stable purchasable capabilities backed by existing domain modules. No prices implied."""
from django.core.exceptions import ValidationError
from .registry import MODULES

CATALOGUE = {
    'fleet': ('Fleet & driver records', 'Register the vehicles and drivers required for movements.'),
    'yard': ('Yard & gate control', 'Arrivals, queue and controlled physical exits.'),
    'docks': ('Dock operations', 'Confirmed docks, assignment and occupancy.'),
    'inspection': ('Inspections & evidence', 'Readiness checks, evidence and recorded evaluations.'),
    'release': ('Release approvals', 'Independent decisions and operational release safeguards.'),
    'routing': ('Dispatch & delivery', 'Routes, consignments, destinations, delivery exceptions and returns.'),
    'reports': ('Operational intelligence', 'Recorded yard activity graphs, summaries and exports.'),
    'modelling': ('Synthetic modelling', 'Labelled scenario exploration; no measured-performance claim.'),
    'notifications': ('Notifications', 'Configured notification adapters; delivery requires provider setup.'),
    'audit': ('Audit & history', 'Accountable records and retained operational history. Included.'),
}


def dependencies(module):
    # Safety is bundled with yard operations, never an optional checkout choice.
    return sorted(set(MODULES[module]) | ({'inspection','release'} if module == 'yard' else set()))


def expand_modules(values):
    if not isinstance(values,list) or any(not isinstance(v,str) or v not in MODULES for v in values) or len(set(values)) != len(values):
        raise ValidationError('Select distinct supported module identifiers')
    selected = set(values) | {'audit'}
    while True:
        expanded = selected | {dependency for module in selected for dependency in dependencies(module)}
        if selected == expanded:
            return sorted(selected)
        selected = expanded


def catalogue():
    return [{'key':key,'name':name,'description':description,'requires':dependencies(key),'included':key=='audit'}
        for key,(name,description) in CATALOGUE.items()]
