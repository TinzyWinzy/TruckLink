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
