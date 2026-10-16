# Modelling sweep registry and phase gates

Adopted from AEHML's freeze-memo discipline on 16 October 2026. This document
owns two rules for the synthetic/Markov modelling work in `backend/regulatory/modelling.py`,
`backend/yard/management/commands/fit_stage_transitions.py` and the Rust kernel.

## Rule 1: registered sweeps only

Any change to the synthetic transition matrices, recheck policy or any
parameter sweep fitted from operational records must be registered in the
table below **before** results are run and examined. Each entry carries its
pre-stated acceptance criterion. Post-hoc tuning after seeing outputs is
p-hacking territory and is rejected regardless of how the numbers look.
Adapted from AEHML FREEZE_MEMO_20260923: further unregistered batches are the
failure mode; this registry is the countermeasure in Trucki.

| Date | Change / sweep | Axes + seeds | Pre-stated acceptance criterion | Outcome |
|---|---|---|---|---|
| 2026-10-16 | Phase 1 synthetic first-order chains (initial distribution, 7-state transitions, HOLD recheck rows, 20-50 min recheck delay) | seed 42/43 ground truth | Row sums = 1 (test); scenario checks 7/7 match expected; reproducible by seed; digest pinned in test_modelling.py | Implemented, pinned digest 21b078ee...4b363 |

## Rule 2: adoption gates for fitted matrices

A stage-transition matrix fitted from real records may leave
`fit_stage_transitions` output (reports, dashboards, alerts) only when all of
these hold:

1. Row-level counts from real data meet or exceed the frozen
   `min_transitions` default (8) per the report — the guard may not be
   lowered to make a demo work.
2. Out-of-time validation: fit on older visits, hold out newer ones; a matrix
   that does not predict held-out stage sequences does not ship.
3. Evidence labels: fitted matrices are always reported as models of recorded
   stage ownership, never as verified operational law; gaps between ownership
   assignments are never presented as stage dwell.

## Rule 2 status today (VERIFIED FACT)

Dev sqlite has 0 movement ownership rows; production counts unknown until
`fit_stage_transitions` is run against live data with `--output` persisting
dated JSON under `docs/analysis/`. No fitted matrix has left a report context.

## Frozen gates

| Gate | Status | Unlock requires |
|---|---|---|
| Phase 4 (Rust Markov math module) | GATED (unproven data volume) | Verified per-transition counts from real records **and** measured Python-side fit/solve cost that justifies native code |
| `min_transitions` default (8) | FROZEN | A dated memo in this file revising it, never a silent commit |
| Native kernel adoption into Django runtime | NOT STARTED | Workload-level benchmark (`full_model_benchmark.py`) showing end-to-end win incl. RNG, report construction, digest |
