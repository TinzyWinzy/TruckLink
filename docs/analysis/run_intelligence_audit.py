"""Reproduce bounded intelligence-audit checks. Synthetic inputs; no DB/network access.

Run from the repository root with backend/.venv/Scripts/python.exe.
Uses a small standard-library notebook executor because Jupyter is not installed.
"""
from contextlib import redirect_stdout
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def markdown(source):
    return {"cell_type": "markdown", "metadata": {}, "source": source.splitlines(True)}


def code(source):
    return {"cell_type": "code", "metadata": {}, "execution_count": None,
            "outputs": [], "source": source.splitlines(True)}


cells = [
    markdown("""# Trucki intelligence: reproducible audit checks

## Summary
These checks exercise existing calculation code using invented records. They test software
behaviour and analytical limitations, not customer performance, statutory law or demand.
Exact results follow below. No database queries or network requests are made.

## Context and methods
Scope: local working tree on 2026-10-07, including the uncommitted consignment foundation.
Sources: `backend/regulatory/modelling.py`, `backend/yard/reports.py` and their evaluator imports.
Run `backend/.venv/Scripts/python.exe docs/analysis/run_intelligence_audit.py` from the repo root.
The script executes every code cell in order and saves outputs plus a source fingerprint.
Jupyter packages are absent, so execution uses Python compile/exec, not a Jupyter kernel.
The notebook uses only plain text tables; no charts are needed for these three bounded checks.

### Key assumptions
The capacity comparison uses 20 paired seeds, 72 invented arrivals, 36 arrivals/hour and
20-minute mean service. Only synthetic PASS cases consume docks. These are stress-test inputs,
not estimates of any tenant. Invalid timestamps and legacy milestones below are invented.
"""),
    code("""from pathlib import Path
import os, sys, json, statistics, hashlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
root = next(p for p in (Path.cwd(), *Path.cwd().parents) if (p / 'backend/regulatory/modelling.py').exists())
sys.path.insert(0, str(root / 'backend'))
os.environ['DJANGO_SETTINGS_MODULE'] = 'spotter_backend.settings'
os.environ['DJANGO_SECRET_KEY'] = 'synthetic-intelligence-audit-only'
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
import django
django.setup()
from regulatory.modelling import run_model
from yard.reports import compute_turnaround_stats
results = {'synthetic': True, 'customer_data': False, 'verified_law': False}
sources = ['backend/regulatory/modelling.py', 'backend/yard/reports.py',
           'backend/regulatory/services.py', 'backend/regulatory/engine/evaluator.py',
           'backend/compliance/policy.py']
results['source_sha256'] = {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in sources}
print('Local source fingerprints captured. Synthetic inputs only.')
"""),
    markdown("""## Results
### 1. Capacity sensitivity, not a forecast
Compare identical random seeds and arrival/decision/service draws across dock counts.
The min/max columns describe seed variation, not confidence intervals for real operations.
"""),
    code("""runs = {d: [run_model(seed=s, vehicles=72, docks=d, arrivals_per_hour=36, service_minutes=20)
            for s in range(20)] for d in (2, 3, 4)}
summary = []
for d, values in runs.items():
    waits = [r['summary']['average_wait_minutes'] for r in values]
    summary.append({'docks': d, 'mean_of_run_mean_wait_minutes': round(statistics.mean(waits), 2),
                    'min_run_mean_wait_minutes': min(waits), 'max_run_mean_wait_minutes': max(waits),
                    'mean_blocked': statistics.mean(r['summary']['blocked'] for r in values)})
for seed in range(20):
    baseline = runs[2][seed]
    for d in (3, 4):
        candidate = runs[d][seed]
        assert candidate['summary']['decisions'] == baseline['summary']['decisions']
        assert candidate['summary']['average_wait_minutes'] <= baseline['summary']['average_wait_minutes']
        assert candidate['summary']['scenario_checks_passed'] == 7
assert run_model(seed=42)['result_digest'] == run_model(seed=42)['result_digest']
results['capacity_stress_test'] = summary
results['capacity_checks'] = {'paired_seeds': 20, 'runs': 60, 'seven_cases_match_all_runs': True,
                             'blocked_counts_unchanged_by_dock_count': True, 'repeatable_digest': True}
print(json.dumps(summary, indent=2))
print('All 60 runs match seven invented evaluation cases. Added docks do not resolve blocked cases.')
"""),
    markdown("""### 2. Hidden denominator and milestone differences
Test one physical exit, one legacy completion proxy, one active movement, one reversed timestamp
and one missing timestamp. Report total counts all five, while the duration means exclude two.
A completion proxy is a different event from physical exit and must be segmented in benchmarks.
"""),
    code("""now = datetime(2026, 10, 7, 12, tzinfo=timezone.utc)
def row(status, entered, exited=None, updated=None, semantics='SEPARATE_V1'):
    return SimpleNamespace(status=status, entry_timestamp=entered, exit_timestamp=exited,
                           updated_at=updated, milestone_semantics=semantics)
sample = [row('RELEASED', now-timedelta(minutes=120), now-timedelta(minutes=20)),
          row('COMPLETED', now-timedelta(minutes=120), updated=now-timedelta(minutes=100), semantics='LEGACY_COMBINED'),
          row('QUEUED', now-timedelta(minutes=75)),
          row('RELEASED', now-timedelta(minutes=10), now-timedelta(minutes=20)),
          row('QUEUED', None)]
mixed = compute_turnaround_stats(sample, now)
physical = compute_turnaround_stats(sample[:1], now)
assert mixed['total'] == 5 and mixed['avgTurnaroundMinutes'] == 60
assert physical['avgTurnaroundMinutes'] == 100
results['duration_coverage'] = {'reported': mixed, 'physical_exit_only': physical,
                               'valid_duration_rows': 3, 'excluded_duration_rows': 2,
                               'legacy_proxy_completed_rows': 1}
print(json.dumps(results['duration_coverage'], indent=2))
"""),
    markdown("""### 3. Tenant threshold changes the action count
A 75-minute active movement breaches 60 minutes but not 90 minutes. This is a policy choice,
not a statistical risk estimate; thresholds need tenant/site/service definitions and versions.
"""),
    code("""active = [row('QUEUED', now-timedelta(minutes=75))]
counts = {str(limit): compute_turnaround_stats(active, now, overdue_minutes=limit)['overdueCount']
          for limit in (60, 90)}
assert counts == {'60': 1, '90': 0}
results['threshold_sensitivity'] = counts
print(json.dumps(counts, indent=2))
(root / 'docs/analysis/intelligence-audit-results.json').write_text(json.dumps(results, indent=2) + '\\n', encoding='utf-8')
"""),
    markdown("""## Takeaways
The model supports reproducible what-if comparisons within its assumptions. Dock capacity does
not fix evidence/policy holds. The report helper mixes legacy completion proxies with actual exits
and lacks duration-coverage denominators; segment them before performance benchmarking.
Tenant thresholds change which movements demand attention. None of these checks proves an
unmet customer need, production adapter reliability, prediction accuracy or financial benefit.
"""),
]

namespace = {"__name__": "__main__"}
for count, cell in enumerate((c for c in cells if c['cell_type'] == 'code'), 1):
    output = io.StringIO()
    with redirect_stdout(output):
        exec(compile(''.join(cell['source']), f'<audit-cell-{count}>', 'exec'), namespace)
    cell['execution_count'] = count
    cell['outputs'] = [{"output_type": "stream", "name": "stdout", "text": output.getvalue().splitlines(True)}]
    print(output.getvalue(), end='')

notebook = {"nbformat": 4, "nbformat_minor": 4, "metadata": {
    "kernelspec": {"display_name": "Python 3 (Trucki backend venv)", "language": "python", "name": "python3"},
    "language_info": {"name": "python"},
    "audit": {"executed_at": datetime.now(timezone.utc).isoformat(),
              "executor": "standard-library sequential compile/exec; no Jupyter kernel"}}, "cells": cells}
destination = HERE / 'trucki_intelligence_audit.ipynb'
destination.write_text(json.dumps(notebook, indent=2) + '\n', encoding='utf-8')
saved = json.loads(destination.read_text(encoding='utf-8'))
assert saved['nbformat'] == 4 and len(saved['cells']) == len(cells)
assert all(c['execution_count'] and c['outputs'] for c in saved['cells'] if c['cell_type'] == 'code')
print(f'Saved and structurally checked {destination.name}; no production data accessed.')
