# Trucki intelligence audit and opportunity assessment

Date: 7 October 2026. Scope: current local working tree, including the consignment changes that have not been deployed. This is a source audit, primary-source market review and bounded synthetic calculation check. It is not a fresh production walkthrough or an analysis of customer operating data.

Follow-up: the subsequent [live dashboard implementation](LIVE_DASHBOARD.md) replaces the Reports analytics path with native authenticated aggregates and separates physical exits from legacy proxies in its new metrics. Findings below describe the audited state before that change; the legacy turnaround helper and latest-100 handoff limit remain separate outstanding work.

## Judgment

Trucki has a credible foundation for operational intelligence: linked movements, recorded evidence, reproducible decisions, independent approvals, accountable handoffs and delivery outcomes. Today its intelligence is mostly descriptive and rule-based, distributed across operational screens. It does not yet provide a coherent, measured decision service or a validated predictive product.

The strongest hypothesis is **an evidence-backed transport exception and handoff intelligence layer alongside existing ERP, WMS and tracking systems**. Each insight should answer: what needs attention, what evidence establishes it, what consequence is possible, who owns the next action, and whether that action worked.

The customer opportunity remains unvalidated. In this review the user explicitly confirmed that Samuel or Tariro has not yet identified a specific recurring costly problem. Tariro's comments concern Trinitas; they establish reported existing ERP capabilities, not a BAK requirement. No second tenant should be configured before its operational discovery.

## What is already real in the code

| Capability | Evidence | Intelligence it can support | Present limit |
| --- | --- | --- | --- |
| Tenant/site context and configurable workflows | `backend/tenancy/`, `tenants/`, authenticated site resolution | Tenant-specific thresholds, policies, owners and comparisons | Configuration is not evidence of production adoption or integration |
| Regulatory and operational decision provenance | `backend/regulatory/engine/evaluator.py`, `backend/regulatory/services.py` | Explain failed requirements against retained rules and evidence | A configured rule is not automatically verified law; an inspection pass is not physical exit |
| Movement handoffs and ownership | `backend/core/operations_views.py`, `web/src/components/MovementWorklist.tsx` | Missing setup, assigned owner, unavailable owner and next required action | Current age is visit age, not duration of the current blocker or handoff |
| Pending reviews and expired evidence | `backend/core/operations_views.py:pending_approvals` | Review backlog, independent review, already expired evidence | Latest 200 revisions per evidence type; no demonstrated departure-horizon expiry forecast |
| Queue, dock snapshots and turnaround calculations | `backend/yard/views.py`, `backend/yard/reports.py`, `web/src/routes/Reports.tsx` | Current congestion and elapsed/completed durations | Mean-only summaries, fixed thresholds, legacy milestone mixing and incomplete denominator disclosure |
| Journey and delivery/return events | `backend/journeys/models.py`, `backend/journeys/views.py`, `backend/journeys/execution.py` | Missed handoffs, rejection/reattempt/return episodes and evidence completeness | ERP and tracker remain explicitly NOT_CONFIGURED; commercial closure remains separate |
| Customer consignment commitments | `backend/journeys/consignments.py`, `docs/CONSIGNMENT_WORKSPACE.md` | Target versus allocated versus physically accepted quantity, overdue obligations | Local uncommitted work; no allocation correction/cancellation or replacement dispatch for returned reservations |
| Notification outbox and escalation logic | `backend/core/notify.py` | Escalation of unresolved alerts using configured workflow windows | Code existence does not establish provider delivery, scheduler operation or accountable recipient receipt |
| Seeded capacity/evaluator modelling | `backend/regulatory/modelling.py` | Reproducible scenario comparison and policy test cases | Invented population and service distributions; not calibrated prediction |

Trip `scheduled_start` exists, but a field in the database does not establish completeness, reliability or adoption. Current consignment deadlines are dates in the origin site's timezone, not timed appointment windows. Trip positions have source/accuracy fields but their timestamp is server creation time; this cannot substitute for a tracker provider's original observation time.

## Findings to address before expanding the intelligence claim

### 1. Analytics has two incompatible data/auth paths

The operational client uses Django staff access/refresh tokens (`web/src/lib/api.ts`, `live.ts`). The heatmap/surge client (`web/src/lib/analytics.ts`) still requires `Firebase auth.currentUser` and an ID token. Its availability flag only checks whether VITE_SYNC_API_URL is set; missing users, HTTP failures and network failures all become null.

Generated legacy server files (`server/dist/index.js`, `server/dist/analytics/queries.js`) require Firebase identity and query a separate `queue_entries` schema. There are no corresponding analytics routes in the current Django route registry. These generated remnants do not establish a running deployment or synchronized data. Enabling an environment variable alone will not connect the current staff workspace to reliable analytics.

Recommendation: put native operational aggregates behind the same tenant/site authorization and source database as the operational API. Show explicit loading, unavailable, failed and stale states. Remove or formally retire the disconnected legacy analytics path after migration verification.

### 2. Reports need metric contracts, not more cards

Reports uses a hardcoded 60-minute overdue threshold and 85% dock snapshot warning. Dock load is correctly described in its hint as occupied docks in a snapshot; it is not occupied dock-minutes divided by available dock-minutes. The average active wait is elapsed time since arrival, including stages beyond simply waiting for a dock.

The duration helper uses `updated_at` for legacy RELEASED/COMPLETED records without an exit. New SEPARATE_V1 records require physical exit. These are different events and must not form one undifferentiated performance benchmark. Missing/reversed timestamps are excluded from averages but the returned total still includes those records; duration sample counts and exclusions are absent.

Recommendation: expose eligible counts, missing/invalid counts, milestone semantics, event-time cohort, timezone, observation period and metric version. Add median/P90 only after defining the population. Derive tenant/site/service targets from versioned operating policy rather than declaring a global threshold to be a risk score.

### 3. History can be analysed locally; external feeds are not required for every insight

Reports currently asks for corridor and historical dwell feeds together. Corridor intelligence needs external observations. Native historical visit durations can already be queried through `/reports/turnaround/` and retained milestones, subject to the coverage and legacy caveats above. This is a near-term opportunity that does not require buying a tracker integration first.

The yard board currently serializes all matching queue rows and the frontend polls every five seconds. Reports subscribes separately to queue and docks. The operations workspace considers only the latest 100 visits, while the worklist shows a short ranked subset. This combination creates an unbounded board-read cost and a possible omission of older active problems from the handoff view. No production load benchmark was run in this audit.

Recommendation: separate paginated operational worklists from server-side historical aggregates. Select active unresolved records independently of the historical visit limit. Return total eligible counts and truncation/cursor metadata. Avoid repeated full-history board downloads to calculate a few metrics.

### 4. The attention list is useful prioritisation, not predictive risk

Its attention score is one million for any blocker plus visit age. This puts blocked movements first but does not estimate missed commitments, imminent expiry, hold duration, confidence or financial loss. Tenant-wide review revision limits can also omit older unresolved reviews. Do not label these lists complete or statistically predictive without qualification.

Recommendation: use transparent categories such as blocked, due soon, overdue, owner missing and source stale. Include the exact rule, policy revision and timestamp behind each item. Introduce per-episode start/end events for holds and handoffs instead of inferring time stuck from arrival time.

### 5. The modelling surface is a sandbox

The existing model uses exponential arrivals, uniform service durations and an invented decision mix. Only PASS movements consume docks; blocked movements do not consume yard capacity or inspection effort. Shift patterns, compatible bays, return demand, breakdowns and appointment priorities are absent. The same seed is valuable for paired what-if comparisons, but is not evidence that a forecast will hold at a real site.

### 6. Product documents and legacy money calculations undermine the evidence standard

`docs/PRD_v2_Trucki.md` explicitly states that demand is unvalidated, but also contains incident-cost, statutory fee and prevented-fines payback assertions. Generated legacy ROI calculations sum recorded fee values and divide by a fixed pilot cost. An intercepted check does not prove a statutory liability, an avoided incident or a cash saving. The current Reports UI does not render that legacy ROI summary, but the remnant should not be revived as evidence.

Recommendation: reconcile the PRD/SAD/current system map with today's tenant-aware, complementary positioning. Retire unverified legal and money claims from product success criteria. Do not assert any instrument or monetary penalty to be verified law. Require reconciled customer cost data and an agreed counterfactual before financial-benefit claims.

## Opportunities and what has actually been validated

Priority below reflects technical fit and dependency cost, not established customer willingness to pay. All customer-demand statuses are unconfirmed.

| Priority / opportunity | Operator decision | Existing support | Missing evidence or engineering | Validation decision |
| --- | --- | --- | --- | --- |
| 1. Exception and handoff intelligence | Which movement needs whom to act now? | Blockers, owner assignment, next action, audit, escalation scaffold | Episode timings, complete active backlog, deadlines, acknowledgement/resolution events | Walk through recent exceptions; proceed only if the current ERP/tracker does not already resolve the same handoff adequately |
| 2. Departure readiness and evidence horizon | Can tomorrow's assigned movements be prepared before arrival/loading? | Versioned evidence, expiry, trip assignment and reproducible checks | Complete planned departure data, future effective-date evaluation semantics, revision invalidation and complete evidence inventory | Replay known document/setup failures; require explained warnings and no suggestion that a forecast grants release |
| 3. Bottleneck and rework intelligence | Is delay concentrated in assignment, loading, review or exit? | Arrival/release/dock-vacancy/exit and audit records | Explicit stage/hold episodes, reason taxonomy, workload cohorts, denominator coverage | Reconstruct a bounded history against operator records; choose an intervention only after confirming controllable causes |
| 4. Customer obligation and recovery intelligence | Which commitments remain unallocated, short, rejected or returned? | Parent consignment, exact-unit allocations, accepted quantity, deadlines, return states | Order revisions/cancellations, reservation correction, replacement dispatch, timed windows and ERP reconciliation | Reconcile a complete split-delivery/return case to the order ledger before introducing early lateness claims |
| 5. Cross-system contradiction detection | Why do ERP, tracker and yard disagree, and who resolves it? | External references, source labels, retained observations | Actual providers, stable identity mappings, incremental adapters, observed/received times, conflict policy | Shadow-read one confirmed integration pair; compare flagged contradictions with operator adjudication |
| 6. Calibrated capacity scenarios | Would changed appointments, staffing or dock capacity reduce queues? | Deterministic what-if sandbox | Empirical arrivals/service/hold distributions, bay compatibility, shifts and hold-space occupancy | Backtest against a simple baseline and held-out days before using it for staffing or capacity commitments |

A narrative assistant could later explain a recorded decision and link its evidence. It should not precede the underlying decision facts, complete exception backlog, data-quality checks or customer discovery.

## External validation and competitive implications

The category exists, and it is competitive:

- [project44's decision handoff discussion](https://www.project44.com/blog/fixing-the-decision-handoff-problem-why-execution-breaks-between-planning-and-the-yard/) describes disconnected planning, transit and site decisions despite functioning individual systems. This supports investigating handoff problems as a category; it is vendor positioning, not proof of either prospect's pain.
- [FourKites' yard decisioning offering](https://www.fourkites.ai/outcomes/autonomous-yard-decisioning) promotes decisions based on yard state, inbound ETAs, dock availability and business priority. A generic control tower or AI dashboard is therefore not a sufficient differentiator. Its advertised impact figures were not independently verified or adopted in this assessment.
- [SAP's transport execution documentation](https://learning.sap.com/courses/business-processes-in-sap-s-4hana-transportation-management/monitoring-the-execution-of-the-freight-documents_dc3c1a53-b3d0-4cfa-aa57-5cc76ee06c74) already covers event monitoring, proactive alerts and exception resolution. Do not position every ERP as a passive record keeper. Neither prospect's ERP has been identified as SAP.
- [Geotab's integration guide](https://developers.geotab.com/myGeotab/guides/designingReliableIntegrations/) documents durable feed checkpoints, idempotent processing and corrected older data. It establishes a feasible pattern for supported providers, not an existing Trucki adapter or evidence that either prospect uses Geotab.

The potential differentiation to test is the combination of local operational handoffs, inspectable evidence and policy provenance, useful recovery workflows, and affordable deployment into a confirmed integration gap. Regional fit, affordability and superiority remain hypotheses until demonstrated.

## Bounded computational validation

Reproduce with `backend/.venv/Scripts/python.exe docs/analysis/run_intelligence_audit.py`.
Executed notebook: `docs/analysis/trucki_intelligence_audit.ipynb`.
Machine-readable outputs and source SHA-256 fingerprints: `docs/analysis/intelligence-audit-results.json`.

1. **Capacity sensitivity:** 60 synthetic runs across 20 paired seeds, two/three/four docks, 72 arrivals, 36 arrivals/hour and 20-minute service. Mean of each run's mean wait was 151.08 / 80.42 / 46.33 minutes respectively. This is an invented stress case, not a tenant baseline. All seven invented evaluator cases matched expected decisions in each run. Blocked counts were unchanged by dock count; adding docks did not resolve missing evidence or policy failures.
2. **Milestone/coverage check:** five invented rows produced total=5 while only three had valid durations. Mixing a 20-minute legacy completion proxy with a 100-minute physical-exit duration produced a 60-minute completed average. The physical-exit cohort alone was 100 minutes. This demonstrates different populations/events, not an estimate of live bias.
3. **Threshold sensitivity:** the same invented 75-minute active movement counted overdue at 60 minutes and did not at 90. Targets belong to operating policy; there is no universal statistical inference here.

Execution used a standard-library sequential notebook runner because nbformat/nbclient/Jupyter are not installed. Saved cells and outputs were structurally inspected; full notebook validation and rendered Jupyter presentation were not performed. These are focused calculation checks, not a new end-to-end regression run. No production records were read or modified.

## Minimum intelligence architecture

Use shared platform logic with tenant-owned observations, policies and derived results. Introduce this incrementally, after selecting a confirmed customer decision:

1. **Normalized observation envelope:** tenant/site, source system, external entity/event ID, source version, original observed_at, received_at, provenance/reference, units, quality and replay identity. Preserve corrections and source health. Do not map a received timestamp to an observed timestamp silently.
2. **Identity and ownership:** map source orders, journeys, loads and assets explicitly. ERP owns commercial commitments; WMS owns inventory/loading facts where configured; tracker owns provider telemetry; Trucki owns its recorded inspections, approvals and operational actions. Conflicts create reviewable reconciliation tasks instead of silently overwriting authoritative facts.
3. **Versioned metric definitions:** eligible population, event semantics, exclusions, timezone, aggregation, history window, denominator and threshold policy. Separate observed facts, deterministic inferences, forecasts and human recommendations.
4. **Insight records:** subject IDs, insight kind, detection version, policy version, input references, evidence_as_of, freshness/coverage, explanation, owner, due time, recommended action, acknowledgement and resolution. Suppress/recompute obsolete insights when inputs change. Historical insights retain the inputs that produced them.
5. **Safety boundaries:** recommendations cannot approve their own evidence, bypass independent review or authorize gate release. A tracker geofence may suggest arrival; it cannot stand in for required physical/documentary confirmation. No cross-tenant data pooling or benchmark disclosure by default.
6. **Operational delivery:** role-appropriate decision inbox, deadline/owner filters, source-health status and explainable drill-down. Configurable digest/escalation deduplication and resolution must precede broad notifications. Use existing tenant-configured integration adapters; onboarding a new company must not fork core logic.

Start with relational derived queries and explicitly bounded historical aggregates. This audit supplies no evidence that a new warehouse, language model, vector database or new infrastructure provider is necessary.

## KPI contracts for a first shadow pilot

| Measure | Definition / grain | Qualification |
| --- | --- | --- |
| Actionable exception precision | Operator-adjudicated actionable distinct insight episodes / adjudicated episodes | Report reviewed fraction and unknowns; deduplicate updates to one episode; includes failures and false positives |
| Missed exception coverage | Known actionable episodes found / all independently established actionable episodes in the replay set | Requires independent operator/source-ledger ground truth; alert precision alone misses false negatives |
| Warning lead time | Confirmed issue/commitment event time minus first valid warning time, per episode | Negative values are late warnings; unconfirmed cases do not become successes |
| Ownership/acknowledgement delay | First accountable acknowledgement minus detection time | Assignment is not acknowledgement; report owner-missing episodes separately |
| Resolution duration | Valid resolution event minus episode start, by reason and stage | Keep unresolved episodes and age visible; completed-only means hide long-running work |
| Physical turnaround | Confirmed physical exit minus arrival, per visit, median/P90 and eligible n | Separate legacy proxies; compare similar workload/site/shift cohorts; report timestamp coverage and late arrivals |
| Source freshness and join coverage | Received/observed lag and latest successful pull; explicitly matched records / eligible source records | Server poll success alone is not fresh telemetry; expose unmapped records and truncated reads |
| Decision safeguard incidents | Unsupported clearance recommendations, cross-tenant exposure and independence violations | Record every incident; these cannot be traded against throughput |

Service targets and acceptance thresholds should be agreed with the responsible customer owner before the pilot, not chosen to make results look favourable. Financial benefit requires verified costs, an agreed baseline and a defensible attribution method. A before/after change alone does not prove Trucki caused it.

## Discovery and validation sequence

**First: operational discovery.** Samuel and the operations owner at BAK should show a routine movement and recent difficult movements in their existing tools. Ask for the exact missed handoff, who noticed it, how late, what action was needed, how it was resolved and the evidence of cost/service impact. Identify vendor/version, available interfaces, data owners and current controls. Conduct independent discovery with Tariro at Trinitas; do not reuse BAK procedure assumptions as Trinitas configuration.

**Second: bounded replay.** With an agreed, authorized export or read-only adapter, trace a small set of complete journeys including an exception, split delivery and return. Match source IDs and event times, document unknowns and prove that Trucki adds an actionable decision rather than reproducing an existing screen. Maintain separate author/reviewer permissions.

**Third: time-boxed shadow operation.** At one consenting tenant/site, observe approximately two weeks of operations without automatic release or external write-back. The calendar window is a planning proposal; extend it if too few relevant events occur. Capture operator adjudication, existing-system discovery time, acknowledgements, resolutions and source gaps. Measure against a simple transparent rule baseline before predictive methods.

**Go:** a recurring confirmed problem, an accountable buyer/user, accessible evidence, incremental actionable decisions, acceptable false-positive/missed-case rates, and an explicit continuation commitment. **Rework:** unreliable input data, excessive operator maintenance, duplicated capability or unclear ownership. **Stop/pivot:** no recurring problem, no measurable incremental value, or integration effort outweighs the confirmed benefit.

## Recommended next implementation scope, conditional on discovery

First repair analytics lineage and metric semantics, then unify existing blockers/owners/reviews into a complete exception inbox with freshness and episode tracking. Add native historical handoff/dwell analysis and consignment recovery visibility. Configure a real adapter only after the customer's vendor and data contract are known. Calibrate predictive ETA and capacity recommendations later against held-out operational outcomes.

The immediate product question is: **can Trucki reliably turn an unresolved transport exception into an earlier, owned and evidenced resolution that the customer cannot already obtain easily?** That is the opportunity to prove before expanding the feature catalogue.
