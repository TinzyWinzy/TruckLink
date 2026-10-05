# BAK regulatory operations upgrade plan

Date: 5 October 2026. Status: implementation sequence grounded in the baseline audit. Stabilization and the provenance/domain/evaluator/gate foundation have landed in the working tree; see [implementation progress](BAK_IMPLEMENTATION_PROGRESS.md) and [domain/engine contract](REGULATORY_DOMAIN_AND_ENGINE.md) for the exact delta and remaining limits. Remaining phase work stays proposed. The supplied brief is preserved in `briefs/BAK_INTEL_MASTER_BRIEF_2026-10.txt`.

## Product objective and first deliverable

Evolve the demonstrated yard workflow into BAK INTEL with an independently reusable N-ROK transport regulatory gate. Preserve the React/Vite PWA, Django platform, operational routes and visual identity. Use the BAK deployment as a reference client of the domain service; retain organisation/facility isolation so reuse does not require a second product implementation.

First deliverable: one coherent, defensible arrival -> identified vehicle/driver/load/trip -> required evidence -> deterministic gate -> hold/remediation/re-evaluation or eligible release -> passport path. Every screen must read the same interconnected records and explicitly distinguish demo, configured, verified, pending, stale and live state. Broader fleet marketplace/booking work and Copilot should not delay this path.

## Keep / refactor / extend map

| Existing capability | Disposition | Target |
| --- | --- | --- |
| React/Vite, Layout/ui/CSS tokens, existing routes | KEEP/EXTEND | Industrial BAK control interface; gradual navigation extension |
| Django core, Organisation/Facility, RBAC helpers | KEEP/REFACTOR | Server authority, selected facility, reviewer permissions and adapter credentials |
| Vehicle/Driver/Trip models | EXTEND | Structured regulatory context reused by yard and APIs |
| Queue/docks/alerts and mass checks | KEEP/REFACTOR | Command services with locks; separate gate decision; complete audit |
| ComplianceConfig and pilot numbers | MIGRATE/REFACTOR | Unverified legacy entries plus published immutable rulesets; no live defaults |
| Existing validators | KEEP AS BASELINE/EXTEND | Pure applicability/evaluation engine with explicit missing/config-required outcomes |
| Quarantine/dual-approval endpoints | KEEP/REFACTOR | Immutable original evaluation; explicit override policy and segregated approvals |
| Dexie outbox/service worker | KEEP/REFACTOR | Actor/site/version/time integrity, durable failures, secure offline read cache |
| PowerSync/Firebase data/old PIN/analytics | RETIRE AFTER CONSUMER MIGRATION | One REST data/identity path and explicit adapter boundaries |
| Web Serial | KEEP/EXTEND | Calibrated-device metadata, unit-safe measurements, manual-input distinction |
| Reports/CSV/audit | KEEP/EXTEND | Record-derived operational/regulatory metrics and evidence exports |
| Seeds | REFACTOR | One canonical fixture: BAK scenarios, documents, approvals and evaluated events |
| Trip booking/HOS/customer commerce APIs | PRESERVE BUT ISOLATE SCOPE | Consumer inventory; unrelated US-HOS cannot influence regulatory evaluation |
| docs/reference WMS/events | KEEP AS REFERENCE | Implement selected adapters only when requirements/access are known |

## File-level implementation map

Paths below are proposed additions/edits, not new parallel apps.

| Area | Files to edit/add | Change |
| --- | --- | --- |
| Release authority | `backend/yard/views.py`, `serializers.py`, new `yard/services.py`, `compliance/views.py`, `core/rbac.py` | Strip critical status from generic PATCH; service commands, locks and evaluation-bound release/override |
| Compliance inputs | `backend/compliance/serializers.py`, `engine.py`, `views.py`; `web/src/lib/live.ts`, `routes/ComplianceCheck.tsx` | Server-controlled limits, rated-mass references, validated checklist/evidence; demo-only legacy arithmetic |
| Regulatory domain | New `backend/regulatory/{apps,models,services,serializers,views,urls}.py`, `engine/{types,applicability,evaluator,decisions}.py` | ROU/source/version/event/evaluation lifecycle; pure engine separated from ORM orchestration |
| Installation/routing | `backend/spotter_backend/settings.py`, `urls.py`, `backend/trip/urls.py` | Register regulatory app; group new endpoints by domain; retain existing endpoint contracts |
| Operational linkage | `backend/trip/models.py`, `backend/yard/models.py`, new `yard/migrations/*`, `regulatory/migrations/*` | Vehicle/driver/trip/load links; immutable snapshots; separate decision/operational state |
| Evidence/passports | New `backend/evidence/{models,services,serializers,views,urls}.py`; regulatory release service | Evidence storage metadata/access/verification; passport generated only with release evidence |
| Audit | `backend/core/audit.py`, `yard/models.py`, migrations and tests | Versioned canonical event hash; immutable authorization/evaluation records; no false ledger claims |
| Offline | `web/src/lib/offline/db.ts`, new `offline/replay.ts`, `lib/live.ts`, `components/Layout.tsx`, `sw.ts` | Versioned Dexie schema, session/site partitions, queue locking, retention/conflicts, private cache policy |
| Session/context | `store/session.ts`, `lib/api.ts`, `lib/liveGate.ts`, `App.tsx`, `Layout.tsx`, `routes/Login.tsx` | Selected authorised facility, one logout flow, session-scoped feeds; loading/error/freshness states |
| Demo data | `lib/demoData.ts`, new `store/demo.ts`, `routes/*`, new backend fixture/seed command | Canonical interconnected dataset; deterministic scenario clock; shared demo evaluation/audit/passport |
| UX extension | Existing `routes/ComplianceCheck.tsx`, `Reports.tsx`, `QueueDashboard.tsx`; new `routes/regulatory/*`, `routes/Evidence.tsx` | Extend compliance route first; source/result drilldowns; no duplicate gate implementation |
| Integration boundary | New `backend/integrations/` adapter protocols; `lib/weighbridge/serial.ts`; `web/openapi.yaml` | Explicit capabilities/status, authenticated evaluation API and contract; no fake connectivity |
| Dependency cleanup | `lib/powersync/*`, `lib/pin.ts`, `lib/firebase.ts`, `lib/analytics.ts`, package manifest/lock, Firestore artifacts | Move consumers onto canonical REST/demo paths, then retire dependencies/files with regression evidence |
| Build/deploy | `.github/workflows/ci.yml`, backend requirements/dev lock, settings/templates, `render.yaml`, deployment docs | Reproducible tests; Postgres job; notification runner; correct origins, secrets and environment separation |

Do not start with a backend project-package rename or web/frontend directory rename. Those are unrelated migration risk while product boundaries are unsettled. Move endpoints into domain URL modules without breaking clients; a new pure service does not require a separate network microservice.

## Required schema and data migrations

1. **Baseline/export:** snapshot schema and obtain a safe data inventory before any real-data migration. Classify demo versus operational rows explicitly. Preserve BAK demo scenario IDs/plates; do not infer identity merely from driver display names.
2. **Legacy trust:** annotate existing configuration/checks with LEGACY_DEMO_UNVERIFIED and original source-system metadata. Backfill missing provenance/version as unknown, never invented VERIFIED. Existing releases without full evidence remain historical legacy releases; do not manufacture passports.
3. **Context bridge:** add nullable QueueEntry vehicle/driver/trip/load links and structured vehicle/route/operation context. Backfill unambiguous tenant-scoped matches; queue unresolved matches for review. Preserve existing plate/name text as historical snapshot. Introduce Load with cargo class/dimensions/units; leverage Trip instead of creating another trip model.
4. **Source/ROU:** RegulatorySource and source versions store instrument/provision, authority, jurisdiction, tier, effective/publication dates, canonical document reference/hash and reviewer status. ROU revisions store typed applicability, requirements, evidence requirements, decision logic, override policy and failure action. Separate internal operational policies and manufacturer ratings from statute.
5. **Ruleset publication:** immutable RuleSetVersion + exact ROU/source revision membership, approval and activation record. Define jurisdiction/event scope; prevent conflicting active versions. Hash canonical version content. Tier D extraction creates PROPOSED only; VERIFIED and ACTIVE require authorized review. Historical references are protected from deletion.
6. **Events/evaluations:** RegulatoryEvent stores actor/site/entities, occurrence time, receipt time, context snapshot and idempotency. Evaluation stores ruleset ID/digest, applicability trace, input/evidence snapshots and per-control result/remediation. Append re-evaluations; never overwrite historical result.
7. **Remediation/override:** QuarantineRecord, RemediationEvent and OverrideEvent attach to evaluation/control IDs. Capture requester/approver identity/time/reason/evidence/scope; enforce no self-approval and NOT_ALLOWED policies. Record original decision plus authorized operational disposition separately.
8. **Evidence/passport:** EvidenceRecord with issuer, type, linked entity, collection/issue/expiry time, verification and protected file references. Passport references released dispatch/trip, immutable evaluation, evidence revisions, approvals and release event. Historical files and rules require retention/protection semantics; draft retention policy awaits BAK/legal approval rather than guessed statutory years.
9. **Constraints:** replay unique constraints include tenant/facility/operation key; payload digest mismatch yields conflict. Validate tenant consistency on every FK. Dock occupancy and release prerequisites enforced transactionally. Use Decimal or defined rounding where needed, explicit mass/dimension units and finite numeric validation.
10. **Offline schema:** increment Dexie version; migrate existing pending actions without deleting them. Preserve original actor/context/times; actions lacking ownership become reviewable legacy items rather than automatically assigned to the next session. Cache published verified rule bundles and their digests. Server reconciliation preserves an offline evaluation and may append a new evaluation under current policy; it must not rewrite the old version. Offline assessments do not silently authorize a live gate release without approved release policy.

Existing CASCADE behavior must be reviewed before adding regulatory records: organisation/facility/queue deletion must not silently erase required decision/evidence history. Append-only model methods alone are insufficient guarantees.

## Engine contract and language decision

Keep Python as the canonical server evaluator inside the existing Django platform, with no HTTP/ORM/LLM dependency in its pure evaluator. The service accepts a resolved immutable ruleset and context; API orchestration authorizes the request, resolves trusted data/evidence, invokes the evaluator and records output atomically.

An offline TypeScript evaluator is justified only when BAK requires local assessment. Define a restricted JSON rule language and version it; run the same conformance vectors in Python and TypeScript. Do not let two hand-maintained threshold tables become two authorities. Schema changes, rule activation and release authorization remain server-controlled. No new Node regulatory server or unnecessary broker in the first delivery.

Define result semantics explicitly: PASS, PASS_WITH_WARNINGS, HOLD, QUARANTINE, REVIEW_REQUIRED. Missing/unverified mandatory configuration cannot produce PASS. Include per-control status/reason/expected condition/input/evidence/source/provision/version. Readiness is a separately computed percentage with published weighting, never a substitute for the decision. Specify deterministic decision precedence, units, date/time handling and effective-rule selection in tests before UI work.

## Phases and exit gates

| Phase | Delivery | Required exit evidence |
| --- | --- | --- |
| 0 Audit/strategy | Audit, plan, source assumptions, architecture boundary | Completed documentation; known gaps distinguished from implementation |
| 0A Stabilize authority | Close F01–F03/F06/F08/F22; fix unsafe demo-success/stale-live claims; reproducible CI | Regression tests deny bypasses, caller limits, missing checklist, foreign replay, unaffiliated fleet writes and production reset |
| 1 Domain/migration | Source, ROU, event, ruleset, evaluation, evidence/operational links and legacy labels | Migration dry-run/reconciliation; old routes work; no historical evidence invented |
| 2 Engine/version/override | Context applicability, verified publication, deterministic decisions, remediation policies | Unit/conformance vectors; version reproduction; forbidden override/self-approval rejected |
| 3 Gate | Extend `/compliance`; inspect control/source/evidence/action; add route alias only if useful | One domestic hold -> remediation -> fresh evaluation -> approved release path |
| 4 Evidence/passport | Verified evidence state, protected files, release-linked passport/export | Released and held scenarios; unauthorized files denied; no orphan passports |
| 5 Regulatory centre | Registry, source detail/provenance, reviewer permissions | Failed control -> revision -> source navigation; activation review logged |
| 6 Watch/impact | Labeled DEMO change discovery, review/reject/approve and impact comparison | New version applies only to future/re-evaluated events; historical result unchanged |
| 7 Yard/executive intelligence | Shared record-derived dashboard, dwell/exceptions, configured diagram | Every number traces to records; no fake map, telemetry, utilization or financial claims |
| 8 Cross-border/abnormal load | Context/evidence/expiry triggers with verified configured rules | Second golden path and CONFIGURATION_REQUIRED when unverified |
| 9 Read-only Copilot | Authorized deterministic retrieval/explanation | Cannot decide law, mutate/activate rules, override or release; app works without AI |
| 10 Adapters/hardening | ERP/WMS boundary, idempotent regulatory API, access/storage/runner/ops | Contract tests; IT review; integration statuses reflect actual capability |

Offline ownership/data-loss fixes belong in 0A; offline regulatory rule-bundle support belongs in phases 1–3 and must be complete before the offline-version acceptance claim. API/service boundaries begin in phases 1–2, even if external adapter hardening lands later. Evidence requirements begin with the engine; a vault screen is not a prerequisite for correct blocking logic.

After each implemented phase: frontend typecheck/lint/unit tests/production build; backend tests/check/migration drift plus relevant PostgreSQL/integration tests. Run browser paths that changed. Add focused negative tests, not just snapshots of successful screens. Obtain required source review and BAK workflow validation before any live regulatory activation.

## Scope control and stakeholder inputs

BAK inputs needed for production behavior: actual sites/roles and release SOP; document samples and evidence ownership; certified axle/rated-mass data and approved statutory instruments/provisions; routes/cargo/abnormal-load conditions; override prohibitions; offline release policy; IT system/API ownership; retention/security requirements; deployment and commercial approval. Progress on scaffolding/labeling/tests does not require these inputs, but VERIFIED sources, CONNECTED adapters and production authority do.

A credible IT review should demonstrate one complete journey and show where rules, identity, evidence, audit and integrations live. Do not promise the entire 50-section brief as the next pilot milestone. Separate demonstrable software, verified regulatory content, actual connected systems and operational acceptance.
