"""Isolated, source-derived full-model comparison. Never imported by Django.

Includes scenario evaluation, RNG, movement construction, summaries, digest,
and JSON rendering. The experimental Rust variant substitutes the scheduling
block only; exact report/digest parity is required before collecting timings.
"""
import argparse
import inspect
import json
import os
import random
import sys
import time
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'spotter_backend.settings')
os.environ.setdefault('DJANGO_SECRET_KEY', 'isolated-modelling-benchmark-only')
import django
django.setup()
from regulatory import modelling
from rest_framework.renderers import JSONRenderer
from benchmark import load_kernel, rust_buffer_batch


def batch_schedule(rng, vehicles, docks, arrivals_per_hour, service_minutes, scenarios, kernel):
    arrivals, accepted, durations, movements = [], [], [], []
    arrival = busy = 0.0
    for index in range(vehicles):
        arrival += rng.expovariate(arrivals_per_hour/60)
        scenario = rng.choices(scenarios, weights=[60,12,5,8,5,5,5])[0]
        result = scenario['result']
        passes = result['decision'] == 'PASS'
        duration = rng.uniform(.8,1.2)*service_minutes if passes else 0.0
        if passes:
            busy += duration
        arrivals.append(arrival); accepted.append(int(passes)); durations.append(duration)
        movements.append({'reference': f'SYN-{index+1:04}', 'arrival_minutes': round(arrival,2),
            'scenario': scenario['id'], 'decision': result['decision'], 'override_eligible': result['override_eligible'],
            'wait_minutes': None, 'turnaround_minutes': None, 'dock': None})
    results = rust_buffer_batch(kernel, arrivals, accepted, durations, docks)
    available = [0.0]*docks
    for row, at, duration, (wait, turnaround, dock) in zip(movements, arrivals, durations, results):
        if dock is not None:
            row.update(dock=dock, wait_minutes=round(wait,2), turnaround_minutes=round(turnaround,2))
            available[dock-1] = at+wait+duration
    return available, arrival, busy, movements


def variants(kernel):
    source = inspect.getsource(modelling.run_model)
    tuned_line = 'bay = available.index(min(available))'
    assert source.count(tuned_line) == 1, 'Scheduling source changed; review experiment'
    original_source = source.replace(tuned_line, 'bay = min(range(docks), key=lambda i: available[i])')
    start = source.index('    available = [0.0] * docks\n')
    end = source.index('    completed = [r for r in movements', start)
    batch_source = source[:start] + (
        '    available, arrival, busy, movements = batch_schedule(rng, vehicles, docks, arrivals_per_hour, service_minutes, scenarios, kernel)\n'
    ) + source[end:]
    def compile_variant(text):
        namespace = {**modelling.__dict__, 'batch_schedule': batch_schedule, 'kernel': kernel}
        exec(compile(text, '<isolated-full-model-experiment>', 'exec'), namespace)
        return namespace['run_model']
    return {'original_python': compile_variant(original_source), 'tuned_python': modelling.run_model,
        'rust_batch_experiment': compile_variant(batch_source)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='docs/analysis/trucki-full-model-benchmark.json')
    parser.add_argument('--repeats', type=int, default=15)
    args = parser.parse_args()
    assert args.repeats >= 5
    implementations = variants(load_kernel())
    parity_cases = 0
    for count in (72, 300, 5000):
        for seed in (0, 42, 43):
            for docks in (1, 3, 12):
                options = {'vehicles': count, 'seed': seed, 'docks': docks, 'arrivals_per_hour': 120}
                expected = implementations['original_python'](**options)
                for name in ('tuned_python', 'rust_batch_experiment'):
                    assert implementations[name](**options) == expected, (name, options)
                    parity_cases += 1
    renderer, runs = JSONRenderer(), []
    for count in (72, 300, 5000):
        options = {'vehicles': count, 'seed': 42, 'docks': 3}
        times = {name: [] for name in implementations}
        byte_counts = set()
        for function in implementations.values():
            function(**options)
        order_rng = random.Random(42)
        for _ in range(args.repeats):
            order = list(implementations)
            order_rng.shuffle(order)
            for name in order:
                started = time.perf_counter()
                body = renderer.render(implementations[name](**options))
                times[name].append((time.perf_counter()-started)*1000)
                byte_counts.add(len(body))
        assert len(byte_counts) == 1
        medians = {name: round(median(samples), 3) for name, samples in times.items()}
        runs.append({'vehicles': count, 'json_bytes': byte_counts.pop(), 'median_ms': medians,
            'rust_vs_tuned_speedup': round(medians['tuned_python']/medians['rust_batch_experiment'], 3),
            'tuned_vs_original_speedup': round(medians['original_python']/medians['tuned_python'], 3)})
    report = {'scope': 'Full synthetic model plus DRF JSON rendering; no auth, database or HTTP transport',
        'production_limit': 'API permits 1–300 vehicles; 5,000 is an experimental larger batch only',
        'parity': {'exact_report_and_digest_comparisons': parity_cases, 'seeds': [0,42,43], 'docks': [1,3,12]},
        'method': f'{args.repeats} randomized interleaved samples per variant and size; Rust includes RNG, buffer conversion and Python row reconstruction',
        'runs': runs}
    Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
