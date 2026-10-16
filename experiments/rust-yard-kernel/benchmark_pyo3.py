"""PyO3 binding parity + comparison harness for the yard kernel.

Compares the maturin-packaged PyO3 module against the pure-Python reference
scheduler on parity fixtures, then times the PyO3 list-input path against the
ctypes bulk-buffer C ABI path. Run with the backend venv interpreter after
`maturin build --release` + wheel install. This spike measures the PyO3
list path; the ctypes bulk-buffer C ABI path in benchmark.py remains the
faster reference for large batches.
"""
import ctypes
import json
import math
import os
import random
import time

from trucki_yard_kernel import simulate_batch as simulate_batch_py


def reference(arrivals, accepted, durations, docks):
    available = [0.0] * docks
    rows = []
    for arrival, ok, duration in zip(arrivals, accepted, durations):
        if not ok:
            rows.append((math.nan, math.nan, 0))
            continue
        bay = available.index(min(available))
        start = max(arrival, available[bay])
        available[bay] = start + duration
        rows.append((start - arrival, available[bay] - arrival, bay + 1))
    return rows


def _close(a, b):
    if math.isnan(a):
        return math.isnan(b)
    return abs(a - b) <= 1e-12


def rows_match(expected, got):
    return len(expected) == len(got) and all(
        _close(e[0], g[0]) and _close(e[1], g[1]) and e[2] == g[2]
        for e, g in zip(expected, got))


def check(label, arrivals, accepted, durations, docks):
    expected = reference(arrivals, accepted, durations, docks)
    got = simulate_batch_py(arrivals, accepted, durations, docks)
    if not rows_match(expected, got):
        raise SystemExit(f'parity MISMATCH on {label}')
    return label


def random_case(size, docks, seed):
    rng = random.Random(seed)
    arrival = 0.0
    arr, acc, dur = [], [], []
    for _ in range(size):
        arrival += rng.expovariate(18 / 60)
        arr.append(arrival)
        acc.append(1 if rng.random() < 0.85 else 0)
        dur.append(rng.uniform(.8, 1.2) * 12)
    return arr, acc, dur, docks


def timed(func, *args, repeats=5):
    samples = []
    last = None
    for _ in range(repeats):
        start = time.perf_counter()
        last = func(*args)
        samples.append(time.perf_counter() - start)
    return min(samples), last


def bench(size, docks, seed=42):
    arr, acc, dur, _ = random_case(size, docks, seed)
    pyo3_best, pyo3_rows = timed(simulate_batch_py, arr, acc, dur, docks)
    pyo3_best = float(pyo3_best)
    lib_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            'target', 'release', 'trucki_yard_kernel.dll')
    report = {'size': size, 'docks': docks,
              'pyo3_list_input_best_seconds': round(pyo3_best, 5),
              'ctypes_bulk_buffer_available': os.path.exists(lib_path)}
    if not os.path.exists(lib_path):
        return report
    lib = ctypes.CDLL(lib_path)
    simulate_batch_c = lib.simulate_batch
    simulate_batch_c.restype = ctypes.c_int32

    def run_c():
        a = (ctypes.c_double * size)(*arr)
        k = (ctypes.c_ubyte * size)(*acc)
        d = (ctypes.c_double * size)(*dur)
        out = (ctypes.c_double * (size * 3))()
        status = simulate_batch_c(a, k, d, ctypes.c_size_t(size),
                                  ctypes.c_size_t(docks), out)
        if status:
            raise SystemExit('ctypes kernel rejected input')
        return [(out[3 * i], out[3 * i + 1], int(out[3 * i + 2])) for i in range(size)]

    c_best, c_rows = timed(run_c)
    c_best = float(c_best)
    report.update(par_ctypes_pyo3=rows_match(c_rows, pyo3_rows),
                  ctypes_bulk_buffer_best_seconds=round(c_best, 5))
    if c_best:
        report['speedup_ctypes_over_pyo3_list'] = round(pyo3_best / c_best, 1)
    return report


if __name__ == '__main__':
    parity_checks = [
        check('ties', [0.0, 0.0, 0.0, 1.0], [1, 1, 0, 1], [5.0, 5.0, 5.0, 2.0], 2),
        check('random-100', *random_case(100, 3, 7)),
        check('random-5000', *random_case(5000, 12, 7)),
    ]
    print(json.dumps({'parity_checks': parity_checks}, indent=2))
    for size, docks in ((100, 3), (5000, 12)):
        print(json.dumps(bench(size, docks), indent=2))
