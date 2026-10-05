# BAK stabilization implementation — 5 October 2026

This records changes after the baseline audit at `d00c28e`. The audit remains historical evidence; this document describes the implemented delta. The master brief's regulatory platform is not complete.

## Implemented

- Dedicated transactional gate release validates the latest recorded inspection, mandatory checklist, tenant/site, independent override approval and reason, then records exit time, dwell, audit and outbox event together. Generic queue PATCH cannot grant inspection, override or release authority.
- Inspection payloads cannot supply limits. Mandatory checklist answers must be literal true. Nonfinite measurements are rejected. Vehicle details cannot be changed through generic PATCH after inspection.
- Inspection replay keys are scoped to facility and bound to normalized payload plus submitting actor. A database uniqueness constraint protects nonempty keys; stale inspection override commands are rejected. Queue, override and dock assignment commands use row locks.
- Inspection and release are restricted to facilities explicitly configured as DEMO. Other sites return CONFIGURATION_REQUIRED until verified rules and rating evidence are implemented. Legacy thresholds and fee calculations remain illustrative demo logic, never an operational authorization.
- Demo reset preserves organisation-wide compliance configuration. Seed/reset reject operational sites.
- Public legacy registration creates an isolated workspace with an executive identity and no yard-site access. Unaffiliated vehicle/driver creation cannot fall back to another organisation.
- Offline writes retain actor, facility and API identity; replay is serialized, ownership checked and backed off. Permanent rejections and five failed attempts retain the command as BLOCKED. Unowned legacy writes are held for review; the header distinguishes queued work and work needing review.
- Real yard screens start empty and report failed reads instead of substituting practice records. Private screens remount when identity changes. Practice override UI no longer claims a server approval. Dock utilisation is unavailable when real history is absent.
- The service worker retires the shared authenticated API cache. The app shell and write outbox remain available offline; private read snapshots require a future actor/site-scoped implementation.
- CI installs a separate development requirements file and uses Node 24; CI's seeded site is explicitly DEMO. Removed the practice alert path's PowerSync dependency from the active bundle.

## Deployment and data handling

1. Back up and inspect the target database before applying migration `yard/0005`. It adds a submission digest and a conditional unique facility/key constraint. It deliberately stops if legacy duplicate keys exist; reconcile with evidence instead of deleting inspection history.
2. Existing inspection digests are left blank. Replaying an old key returns conflict rather than treating an unverifiable old payload as a matching submission.
3. Existing sites with no mode are treated as operational and cannot inspect/release using legacy pilot defaults. Only deliberately selected test sites should have `yard_config.mode = DEMO`. New signup defaults to OPERATIONS; test bootstrap supplies DEMO explicitly. There is no automatic conversion of customer sites.
4. Use `pip install -r requirements-dev.txt` for development/CI and the existing runtime requirements for deployments. Apply the migration and compatible backend/frontend together.
5. Queued commands rejected by the new checks remain saved. A supervised reconciliation/export/retry UI is still needed; do not delete or automatically reassign these commands to the current user.

No existing local customer database was migrated, no customer site was reclassified, and nothing was committed, pushed or deployed in this session.

## Remaining work

The first stabilization slice does not close every audit finding. Audit hashes still cover payload/link rather than a complete metadata envelope; fleet endpoints still need broader mutation-role policy review. PostgreSQL race tests, stronger dock eligibility, immutable inspection/override records, durable notification delivery and dependency locking remain open.

The provenance/domain and evaluator/gate foundation described below has now been implemented. Real source review, workflow approval and integration validation remain required. No instrument or monetary penalty is asserted to be verified law in this change.

## Validation

Tests use disposable SQLite databases and synthetic users. Practice browser tests do not prove live integrations, PostgreSQL concurrency or statutory correctness.

- Targeted backend suite before final regression additions: 157 passed.
- New gate-integrity regression file: 22 passed, including independent override-to-release and rejection of stale approvals.
- Frontend: 58 tests passed across 11 files; lint passed with the existing Fast Refresh warning; TypeScript/production/PWA build passed. Existing large Firebase chunk and deprecated build-option warnings remain.
- Chromium practice flows: 15 passed, retries disabled.
- Django system check: no issues. Migration consistency: no changes detected.
- Full non-live backend suite: 588 passed, 8 deselected, 429.34 seconds. The final vehicle-detail regression was added after this run collected tests and passed in the separate 22-test gate-integrity run. Existing staticfiles and naive-datetime warnings remain.

The original vulnerability reproducer is retired before execution. Current authority expectations are asserted by `backend/tests/test_gate_integrity.py` and offline replay expectations by `web/src/lib/live.outbox.test.ts`.

## Provenance, domain, versioned evaluator and operational gate

Implemented in `backend/regulatory/`; see [domain and engine contract](REGULATORY_DOMAIN_AND_ENGINE.md) for models, API workflow, rule schema, authorization and deployment constraints.

- Added protected source/evidence/configuration revisions and independent review history, explicit effective dates, exact rule-unit membership, canonical ruleset snapshots/digests and independent publication. No automatically verified or seeded regulatory content.
- Connected queue arrivals to configured vehicle, Driver, Trip, Load, explicit route/jurisdictions and evidence through immutable context revisions. No guessed legacy backfill.
- Added immutable inspection attempts, separate exception requests/approvals, and release authority records. Original evaluations remain unchanged after re-evaluation or approval.
- Implemented a pure restricted Python rule evaluator with decimal mass, applicability traces, source references, deterministic decisions, readiness, current-evidence requirements and override prohibitions. Operational evaluation cannot fall back to pilot tables or caller ratings. No operational monetary penalties are calculated.
- Integrated versioned authority into the existing transactional queue-release command, including result reproduction, current context/evidence/rules and freshness checks. Demo seed/reset also refuse sites with versioned history.
- Added the versioned workflow to the existing compliance route: recorded ratings, route context, effective versions, source/control outcomes and separate approvals. Fixed session restoration to preserve protected deep links. New versioned inspection is online only; legacy offline commands remain reviewable rather than silently converted.
- Added a synthetic Chromium UI contract harness to CI alongside the existing live-yard tests. This harness intercepts APIs and does not substitute for actual Django/device/production integration testing.

Migration: `regulatory/0001` and `0002` create empty regulatory tables after `yard/0005`. They preserve existing history and do not create legal sources or verified ratings. Nothing has been migrated or deployed to a customer environment.

Validation for this phase:

- Full non-live backend suite: 606 passed, 8 deselected (429.98 seconds). Later regression additions passed separately in the focused suites below.
- Focused provenance/gate suite: 46 passed before the final demo-history guard.
- Final demo-history guard plus admin/report regressions: 23 passed (37.52 seconds).
- Frontend: 60 tests passed in 12 files with `--maxWorkers=2`; lint and production/PWA build passed. One unrestricted concurrent run encountered two worker-startup timeouts; the bounded rerun passed all files.
- Chromium: versioned UI contract passed with retries disabled; all 15 practice browser tests passed after the session-restoration fix (51.8 seconds).
- Django check and migration drift check passed. Existing staticfiles, naive-datetime, large-chunk and build-option warnings remain.

Remaining limits: production source/document review, PostgreSQL concurrency, physical scale calibration, document-byte storage/verification, issuer/regulator/ERP adapters, offline rule-bundle assessment, regulatory centre authoring UI, passports and full statutory control coverage. The legacy practice workflow remains explicitly unverified for compatibility; it cannot authorize operational release.
