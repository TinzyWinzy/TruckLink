"""Compare the synthetic scheduling loop with Rust, including Python buffer conversion.

Build first with cargo build --release --offline. No operational integration.
"""
import argparse
import ctypes
import json
import math
import platform
import random
import time
import struct
from array import array
from pathlib import Path
from statistics import median


def python_batch(arrivals, accepted, durations, docks, tuned=False):
    available = [0.0] * docks
    output = []
    for arrival, passes, duration in zip(arrivals, accepted, durations):
        if not passes:
            output.append((None, None, None))
            continue
        bay = available.index(min(available)) if tuned else min(range(docks), key=lambda i: available[i])
        start = max(arrival, available[bay])
        available[bay] = start + duration
        output.append((start-arrival, start+duration-arrival, bay+1))
    return output


def prepare(arrivals, accepted, durations):
    count = len(arrivals)
    return ((ctypes.c_double*count)(*arrivals), (ctypes.c_uint8*count)(*accepted),
            (ctypes.c_double*count)(*durations), (ctypes.c_double*(count*3))())


def load_kernel():
    names = {'Windows': 'trucki_yard_kernel.dll', 'Linux': 'libtrucki_yard_kernel.so',
             'Darwin': 'libtrucki_yard_kernel.dylib'}
    library = ctypes.CDLL(str(Path(__file__).resolve().parent/'target'/'release'/names[platform.system()]))
    kernel = library.simulate_batch
    kernel.argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_uint8),
                       ctypes.POINTER(ctypes.c_double), ctypes.c_size_t, ctypes.c_size_t,
                       ctypes.POINTER(ctypes.c_double)]
    kernel.restype = ctypes.c_int
    return kernel


def call(kernel, buffers, docks):
    arrivals, accepted, durations, output = buffers
    status = kernel(arrivals, accepted, durations, len(arrivals), docks, output)
    if status:
        raise ValueError(f'Invalid synthetic kernel inputs ({status})')
    return output


def rust_batch(kernel, arrivals, accepted, durations, docks):
    output = call(kernel, prepare(arrivals, accepted, durations), docks)
    return [(output[i], output[i+1], int(output[i+2])) if output[i+2] else (None, None, None)
            for i in range(0, len(output), 3)]


def prepare_buffers(arrivals, accepted, durations):
    """Bulk buffer copies avoid per-item ctypes boxing; owners stay alive via from_buffer."""
    count = len(arrivals)
    return ((ctypes.c_double*count).from_buffer(array('d', arrivals)),
            (ctypes.c_uint8*count).from_buffer(bytearray(accepted)),
            (ctypes.c_double*count).from_buffer(array('d', durations)),
            (ctypes.c_double*(count*3)).from_buffer(array('d', [0.0])*(count*3)))


def rust_buffer_batch(kernel, arrivals, accepted, durations, docks):
    output = call(kernel, prepare_buffers(arrivals, accepted, durations), docks)
    return [(wait, turnaround, int(dock)) if dock else (None, None, None)
            for wait, turnaround, dock in struct.iter_unpack('=ddd', output)]


def samples(function, repeats=15):
    function()
    times = []
    for _ in range(repeats):
        started = time.perf_counter(); function()
        times.append((time.perf_counter()-started)*1000)
    return round(median(times), 4)


def verify(expected, actual):
    assert len(expected) == len(actual)
    for one, two in zip(expected, actual):
        assert one[2] == two[2]
        for a, b in zip(one[:2], two[:2]):
            assert (a is None and b is None) or (a is not None and b is not None and math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-9))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='docs/analysis/trucki-rust-experiment.json')
    args = parser.parse_args()
    kernel = load_kernel()
    rows = []
    for count in (100, 5000, 50000):
        rng = random.Random(42)
        arrivals, accepted, durations = [], [], []
        arrival = 0.0
        for _ in range(count):
            arrival += rng.expovariate(18/60)
            arrivals.append(arrival); accepted.append(int(rng.random() < .6))
            durations.append(rng.uniform(.8, 1.2)*12)
        for docks in (1, 3, 12):
            expected = python_batch(arrivals, accepted, durations, docks)
            verify(expected, rust_batch(kernel, arrivals, accepted, durations, docks))
            verify(expected, rust_buffer_batch(kernel, arrivals, accepted, durations, docks))
            verify(expected, python_batch(arrivals, accepted, durations, docks, tuned=True))
        buffers = prepare(arrivals, accepted, durations)
        python_ms = samples(lambda: python_batch(arrivals, accepted, durations, 3))
        tuned_ms = samples(lambda: python_batch(arrivals, accepted, durations, 3, tuned=True))
        full_ms = samples(lambda: rust_batch(kernel, arrivals, accepted, durations, 3))
        buffer_ms = samples(lambda: rust_buffer_batch(kernel, arrivals, accepted, durations, 3))
        native_ms = samples(lambda: call(kernel, buffers, 3))
        rows.append({'movements': count, 'python_median_ms': python_ms,
            'rust_with_conversion_median_ms': full_ms, 'rust_preallocated_kernel_median_ms': native_ms,
            'end_to_end_speedup': round(python_ms/full_ms, 2),
            'rust_bulk_buffers_median_ms': buffer_ms,
            'bulk_buffer_end_to_end_speedup': round(python_ms/buffer_ms, 2),
            'tuned_python_median_ms': tuned_ms,
            'bulk_buffer_vs_tuned_python_speedup': round(tuned_ms/buffer_ms, 2),
            'parity_dock_counts': [1, 3, 12]})
    verify(python_batch([0, 0, 0, 1], [1, 1, 0, 1], [5, 5, 5, 2], 2),
           rust_batch(kernel, [0, 0, 0, 1], [1, 1, 0, 1], [5, 5, 5, 2], 2))
    report = {'kernel': 'precomputed synthetic arrival/dock scheduling batch',
        'integration': 'isolated ctypes C ABI experiment, release build; no production dependency',
        'limits': 'Excludes RNG, regulatory evaluation, report construction, hashing and API/DB work. Floating output compared before report rounding.',
        'runs': rows, 'parity': 'Passed 27 batch comparisons plus blocked/tie/wait fixture'}
    Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
