# Trucki Rust yard-kernel experiment

This is an isolated feasibility experiment, not a Django dependency or an operational release evaluator. It computes synthetic dock scheduling from precomputed arrival times, acceptance flags and service durations. Random generation, legal/regulatory controls, evidence, approvals, report dictionaries and canonical audit hashing remain in Python.

CPU profiling identified the simulation loop as a significant part of larger synthetic modelling runs. The experiment compares the existing Python scheduling idiom with a Rust batch kernel and explicitly measures the cost of returning Python tuples.

## Run

From this directory:

```powershell
cargo test --offline
cargo build --release --offline
```

Then from the repository root:

```powershell
.\backend\.venv\Scripts\python.exe experiments/rust-yard-kernel/benchmark.py
```

No Cargo dependencies or extra Python packages are required. The build generates a platform-specific library in the ignored `target/` directory. The Python harness supports Windows, Linux and macOS library names; only Windows was tested here.

## What the benchmark measures

- Python loop: allocation and construction of all result tuples.
- Tuned Python loop: uses `available.index(min(available))` instead of a per-dock callback, preserving the same tie behavior. This is a fairer comparator before choosing a native implementation.
- Naive Rust binding: ctypes input arrays, native execution, per-element output conversion.
- Bulk-buffer Rust binding: array/bytearray copies, native execution, struct iteration into Python tuples.
- Preallocated kernel: native execution alone, useful for understanding potential but not an application speedup claim.

The harness checks parity for 100, 5,000 and 50,000 movements with 1, 3 and 12 docks, and a fixture containing ties, blocked rows and waiting. Rust unit tests cover that fixture and invalid inputs. Comparisons preserve lowest-index dock tie behavior and compare unrounded float results with a tight tolerance.

The raw report is `docs/analysis/trucki-rust-experiment.json`. A faster kernel does not imply that the whole modelling API improves by the same factor. Production adoption would require a workload-level benchmark including RNG, report construction, serialization and hashing; packaging and CI for deployment targets; and a reviewed native boundary. PyO3/maturin would be a suitable packaging option. This prototype's unsafe C ABI is used only with buffers owned by the local harness.

## Full-model comparison

From the repository root after building the library:

```powershell
.\backend\.venv\Scripts\python.exe experiments/rust-yard-kernel/full_model_benchmark.py --repeats 31
```

This isolated harness derives experimental functions from the reviewed local `run_model` source, substitutes its scheduling block and keeps scenario evaluation, RNG order, movement construction, summaries, canonical digest and DRF JSON rendering in the timings. Source markers are checked; a changed scheduling implementation requires reviewing the experiment. No native code is imported by Django.

Exact report and digest equality is checked across 54 comparisons (three sizes, three seeds, three dock counts and two variants). The normal API caps requests at 300 vehicles; 5,000 movements is an experimental batch. Native end timestamps are reconstructed from unrounded arrival/wait/duration, so parity is verified for these fixtures rather than claimed for every possible floating-point input. The raw full-model report is `docs/analysis/trucki-full-model-benchmark.json`.

## PyO3 module status

Phase 3 spike, 16 October 2026. The kernel now ships a PyO3 module (`trucki_yard_kernel`) built with maturin, sharing one `simulate_core` between the maturin-packaged import path and the raw C ABI. `pyproject.toml` is the packaging entry point. Build and install into the backend venv from this directory:

```powershell
& ..\..\backend\.venv\Scripts\maturin.exe build --release -i ..\..\backend\.venv\Scripts\python.exe
& ..\..\backend\.venv\Scripts\python.exe -m pip install --force-reinstall .\target\wheels\trucki_yard_kernel-0.1.0-cp314-cp314-win_amd64.whl
& ..\..\backend\.venv\Scripts\python.exe .\benchmark_pyo3.py
```

Verified on Windows with Python 3.14 (only platform tested, as before): `cargo test` passes (3 tests, including a C-ABI/core parity test), `cargo build --release --offline` still succeeds, the legacy `benchmark.py` ctypes harness still reports parity, and `benchmark_pyo3.py` reports parity across fixtures for the PyO3 path plus `par_ctypes_pyo3: true` at 100 and 5,000 movements.

Measured (PyO3 list input vs ctypes tuple conversion, best of 5): PyO3 was roughly 5-7x faster than the ctypes path (100 movements: 0.00001s vs 0.00007s; 5,000 movements: 0.0008s vs 0.00353s at 12 docks). The honest preallocated-kernel comparison remains `benchmark.py`; PyO3's advantage over the ctypes tuple path comes from avoiding Python-side per-element tuple construction. Larger claims still need the workload-level benchmark including RNG and report construction.

Caveats: the PyO3 path accepts Python lists (no numpy buffer yet); the wheel is installed into the repo venv only; no Django code imports the module; Linux/CI packaging is not yet covered.
