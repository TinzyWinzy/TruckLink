# BAK INTEL user stories and delivery backlog

Draft 1 — 5 October 2026. Baseline: commit `0227260`, plus the deployment findings in [production validation](PRODUCTION_INTERFACE_VALIDATION.md). This is a proposed backlog for stakeholder review, not an approved operating procedure or a statement that every acceptance criterion already passes.

## Product and evidence boundaries

BAK INTEL is the operational interface. N-ROK is the reusable deterministic regulatory service within the existing Django platform. Trucki supplies the platform and broader fleet roadmap. Keep `web/`, `backend/`, current operational routes and existing role codes.

Sources used:

- **PRD:** [Trucki PRD v2](PRD_v2_Trucki.md), functional requirements FR-A through FR-H and NFR-1 through NFR-7.
- **SAD:** [Trucki SAD v2](SAD_v2_Trucki.md), architecture, tenancy, audit, offline, API, deployment and testing sections.
- **Brief:** [BAK master brief](briefs/BAK_INTEL_MASTER_BRIEF_2026-10.txt), especially sections 35–44 and 47–49.
- **Current:** [implementation progress](BAK_IMPLEMENTATION_PROGRESS.md), [regulatory contract](REGULATORY_DOMAIN_AND_ENGINE.md), [upgrade plan](BAK_REGOPS_UPGRADE_PLAN.md), and source files/tests referenced below.

Where the old PRD/SAD conflict with the renewed direction, these stories propose the following reconciliation. Stakeholders should approve the resulting scope:

| Earlier assumption | Story treatment |
| --- | --- |
| Fixed statutory tables and a monetary penalty formula | No instrument or monetary penalty is asserted to be verified law. Operational controls require reviewed source revisions; unavailable configuration blocks evaluation. Pilot arithmetic remains explicitly unverified practice logic. |
| Matching client and server threshold tables | Python is the authoritative evaluator. An eventual offline evaluator must share a versioned schema and conformance vectors, not maintain a second threshold authority. |
| Offline compliance submission already available | Existing arrival outbox is retained. New versioned operational inspection is online only. Offline regulatory assessment is a separate unfinished story. |
| Last-write-wins synchronization | Only appropriate mutable metadata may use conflict resolution. Inspection, approval and release history cannot be overwritten by synchronization. |
| PostgreSQL-only production and no data migration needed | Source supports PostgreSQL; the inspected Render service uses ephemeral SQLite. Existing records require an explicit preservation/disposal decision before redeployment. |
| Proven audit immutability and live integrations | Current audit hash coverage has gaps. File authentication, hardware, notifications and external adapters need their own acceptance evidence. |
| Fleet and commerce expand alongside yard work | Preserve existing fleet code; BAK gate, evidence and defensible release take precedence. Fleet/commerce remain deferred unless BAK requires them. |
| No AI features | A later read-only retrieval/explanation assistant is proposed by the renewed brief. It never decides compliance or grants authority. |

Source review approval is an application review record. It does not, by itself, prove document authenticity or establish that a statutory interpretation is legally correct.

## Delivery legend and personas

**P0:** required for a credible operational pilot. **P1:** next product increment. **P2:** later roadmap. Priority is a proposal, not a committed schedule.

**Existing:** a current operational screen/API exists; remaining criteria still need validation. **Foundation:** domain/API safeguards and tests exist, but the complete user journey or production proof is incomplete. **Partial:** some behavior exists and material criteria are missing. **Planned:** the target capability is absent. None of these labels means production-ready.

| Persona | Current role | Primary outcome |
| --- | --- | --- |
| Gate inspector/dispatcher | DISPATCH_SUPERVISOR | Identify an arrival, record an inspection and perform an authorized release |
| Yard supervisor | OPERATIONS_SUPERVISOR | Allocate docks, resolve holds and handle permitted exceptions |
| Compliance officer/reviewer | COMPLIANCE_OFFICER | Review sources/evidence, publish controls and reconstruct decisions |
| Facility manager | FACILITY_MANAGER | Manage site performance and escalations |
| Executive | EXECUTIVE | Understand operational risk using read-only, traceable metrics |
| Site administrator | ADMIN | Provision authorized users, facilities and configuration |
| Integration operator/BAK IT engineer | Scoped service identity; final policy to define | Consume the engine through an authenticated contract |

No new role code is required simply to write a story. Independence depends on actor identity and authorship as well as role.

## Epic 1 — Access, site context and trustworthy state

### BAK-01 — Sign in to an authorized shift

As a gate inspector, I want to sign in using my provisioned staff ID/PIN or email so that actions are attributed to me and limited to my authorized sites.

**Priority/status:** P0 / Existing. **Sources:** PRD FR-H4, NFR-3; SAD §§5,12. **Evidence:** `web/src/routes/Login.tsx`, `backend/core/views.py`, `backend/trip/auth_views.py`, cross-tenant tests.

Acceptance criteria:

1. Given valid credentials, sign-in establishes the server-authorized role and site access; invalid credentials do not establish a session.
2. Given a protected inspection deep link, session restoration preserves it after refresh; unauthorized access remains denied by the API.
3. Given sign-out or an identity change on a shared device, previous private rows and credentials are unavailable to the next operator.

### BAK-02 — Provision a facility and staff access

As an administrator, I want to create a facility and provision users with explicit roles/site membership so that a new yard can operate without inheriting another organization's access.

**Priority/status:** P0 / Partial. **Sources:** PRD FR-H1,H2,H4; SAD §5. **Evidence:** tenancy signup/PIN provisioning in `backend/core/views.py`; admin screen. **Dependency:** BAK-01.

Acceptance criteria:

1. Given an authorized provisioning request, organization, facility and administrator are linked consistently; operational mode is explicit and defaults to OPERATIONS.
2. Given a staff invitation/provisioning action, only permitted roles/sites may be granted; unauthorized role escalation is rejected server-side.
3. Given another tenant's or an unassigned site's record ID, read and write requests cannot expose or mutate it. Invite lifecycle and full role-policy coverage remain to implement.

### BAK-03 — Select the working site

As a multi-site operator, I want to choose an authorized facility so that the board, inspection, reports and queued work all refer to the same yard.

**Priority/status:** P0 / Partial. **Sources:** PRD FR-H2; SAD §§5,7,8; upgrade plan session/context. **Evidence:** server facility scoping and outbox site identity; complete facility-selector journey is missing. **Dependencies:** BAK-01,02.

Acceptance criteria:

1. Given multiple memberships, the selector lists only authorized facilities and makes the selected site visible.
2. Given a site change, private feeds reload with the new scope; work pending for the old site is retained under its original identity.
3. Given a crafted foreign-site request, server authorization rejects it regardless of the selection displayed in the browser.

### BAK-04 — Distinguish practice, live and unavailable information

As an operator, I want clear data-mode and freshness labels so that I do not mistake training records, stale readings or an API failure for current yard conditions.

**Priority/status:** P0 / Partial. **Sources:** PRD FR-H5; Brief §§0,33,41; current stabilization. **Evidence:** `liveGate.ts`, session store, real route feeds, production smoke tests.

Acceptance criteria:

1. Given practice mode, data is labeled training and no real yard mutation is sent.
2. Given a failed live read, the screen shows failure/retry or last-known freshness, and does not substitute demo rows.
3. Given only a configured API URL, the interface does not imply verified law, healthy integrations or current data; these states are shown separately.

## Epic 2 — Arrival, context and yard flow

### BAK-05 — Register an arrival without losing it

As a gate inspector, I want to register vehicle/driver arrival details online or offline so that a truck enters the shift record even when connectivity drops.

**Priority/status:** P0 / Existing. **Sources:** PRD FR-A1,NFR-1; SAD §7. **Evidence:** queue API, QueueDashboard, Dexie outbox and replay tests. **Dependencies:** BAK-01,03.

Acceptance criteria:

1. Given a valid arrival at my site, the system records identity, capture time and queue state and distinguishes an unsynced local arrival from a server record.
2. Given repeated submission of the same owned arrival, replay does not create duplicate vehicles in the queue.
3. Given another operator/site signs in before reconnection, pending work stays with its original owner and cannot be silently attributed to the new session.

### BAK-06 — Assemble the dispatch context

As a gate inspector, I want to link the arrival to its vehicle configuration, driver, trip, load and route so that applicable controls use the actual dispatch context.

**Priority/status:** P0 / Foundation. **Sources:** Brief §§38,39,41; PRD FR-B1,B2; current domain contract. **Evidence:** `OperationalContext`, `Load`, context API; context-authoring UI missing. **Dependencies:** BAK-05,10,11.

Acceptance criteria:

1. Given a context submission, vehicle/trip/driver assignments agree and every referenced record belongs to the authorized tenant/site.
2. Given a route, its type and traversed jurisdictions are explicit; origin/destination or a place name alone cannot silently choose the governing rules.
3. Given a corrected driver, load, configuration or route, a new context revision is recorded and prior inspection eligibility cannot authorize exit under the replacement context.

### BAK-07 — Allocate an eligible truck to an available dock

As a yard supervisor, I want to assign an eligible queued truck to an available dock so that occupancy stays accurate when multiple operators act at once.

**Priority/status:** P0 / Partial. **Sources:** PRD FR-A2; SAD §§4,11,14. **Evidence:** transactional `DockAssignView`, DockBoard; PostgreSQL concurrency proof and oldest-eligible policy incomplete. **Dependencies:** BAK-05,03.

Acceptance criteria:

1. Given an available dock and eligible arrival at the same site, assignment commits dock occupancy and the truck's dock state together.
2. Given simultaneous attempts to claim a dock or assign the same arrival twice, at most one valid assignment succeeds.
3. Given the approved oldest-eligible allocation policy, the board proposes the correct truck and any permitted deviation records its reason. No automated surge algorithm is required for this story.

### BAK-08 — Monitor the shift queue and dwell

As a yard supervisor, I want a site-scoped board with status and waiting time so that I can identify stalled trucks and prioritize attention.

**Priority/status:** P0 / Existing. **Sources:** PRD FR-A1,A3,A4; SAD §8. **Evidence:** yard board API, QueueDashboard, turnaround reporting. **Dependencies:** BAK-03,05.

Acceptance criteria:

1. Given arrivals, dock activity and releases, board counts reconcile to the same site-scoped records.
2. Given a waiting-time threshold configured by the facility, overdue entries are identifiable using timestamps and the configured timezone.
3. Given delayed polling/network failure, the board displays freshness and uncertainty rather than presenting stale counts as current.

## Epic 3 — Evidence and regulatory configuration

### BAK-09 — Register a source revision with provenance

As a compliance officer, I want to register a source revision with its authority, provision, jurisdiction, document reference and dates so that every control has inspectable provenance.

**Priority/status:** P0 / Foundation. **Sources:** Brief §§34,35,41; current source model/API. **Evidence:** `SourceRevision`, registry views and tests. **Dependencies:** BAK-02.

Acceptance criteria:

1. Given a new source revision, its stable key/revision, source kind/tier, publication/effective dates and document reference/digest are recorded.
2. Given an internal policy or manufacturer source, it is distinguishable from statute; creating any record cannot set its own review approval.
3. Given a source correction, history is appended and protected; existing inspections retain their original source snapshots.

### BAK-10 — Record independently evidenced vehicle ratings

As a compliance officer, I want vehicle configurations supported by rating evidence so that inspectors cannot enter a convenient GVM or axle limit to pass a load.

**Priority/status:** P0 / Foundation. **Sources:** PRD FR-B2 as revised by Brief §§38,41; current domain contract. **Evidence:** `VehicleConfiguration`, evidence review and rating tests. **Dependency:** BAK-11.

Acceptance criteria:

1. Given a configuration, ordered axles, axle/gross ratings, class and effective dates refer to rating evidence for that exact vehicle.
2. Given rating/configuration authorship, an eligible different reviewer must approve the evidence and configuration before use.
3. Given missing, expired, rejected or incompatible ratings, inspection cannot pass and no user-supplied limit or pilot table is substituted.

### BAK-11 — Collect and review entity-linked evidence

As a compliance officer, I want evidence linked to the correct vehicle, driver, trip or load so that the gate can evaluate whether each required document is usable.

**Priority/status:** P0 / Foundation. **Sources:** PRD FR-B1; Brief §§38,39,41; current `EvidenceRevision`/review APIs. **Evidence:** metadata and review exist; protected document-byte storage does not.

Acceptance criteria:

1. Given evidence collection, kind, issuer, issue/expiry time, document reference/digest and exactly one subject are recorded.
2. Given independent approval/rejection or a later revision, history remains available and expiry/revocation changes current eligibility.
3. Given metadata without document authentication, the interface accurately states the review basis and does not claim issuer verification.

### BAK-12 — Securely view supporting files

As a compliance officer, I want to upload and retrieve supporting documents under tenant/site authorization so that decisions are backed by inspectable files without exposing them to unrelated users.

**Priority/status:** P0 / Planned. **Sources:** PRD FR-B1,NFR-3,NFR-6; Brief evidence/passport and security requirements. **Evidence:** reference/digest metadata only. **Dependencies:** BAK-11,02.

Acceptance criteria:

1. Given an upload, allowed type/size and safe metadata are validated, bytes are hashed, and a protected immutable revision is linked to its subject.
2. Given unauthorized access, a copied file URL cannot expose private evidence; access and retention policy are enforceable.
3. Given later file replacement or missing bytes, historical references remain reconstructable and integrity discrepancies are visible. Retention periods require an approved policy.

### BAK-13 — Independently publish an effective ruleset

As a compliance officer acting as an independent reviewer, I want to review control definitions and publish an exact ruleset version so that operational evaluation uses deliberate, traceable configuration.

**Priority/status:** P0 / Foundation. **Sources:** Brief §§35,40,41,44; current ruleset publication contract. **Evidence:** `RuleUnit`, `RuleSetVersion`, publication service/tests; author/reviewer UI missing. **Dependency:** BAK-09.

Acceptance criteria:

1. Given a draft bundle, every rule references an eligible source revision and uses supported typed operators; malformed definitions or arbitrary code are rejected.
2. Given publication, a reviewer independent of relevant authors records a reason; exact membership, digest, scope, effective window and freshness policy are fixed.
3. Given overlapping scope/windows, unreviewed sources or dates outside source applicability, publication is rejected; draft creation never activates controls.

### BAK-14 — Introduce a new version without rewriting history

As a compliance officer, I want a controlled effective-date transition so that future inspections use the new rules while prior decisions remain reproducible.

**Priority/status:** P0 / Partial. **Sources:** Brief §§40,44 acceptance 5; current version tests. **Evidence:** nonoverlapping future versions supported; replacing a currently overlapping published window is not supported. **Dependency:** BAK-13.

Acceptance criteria:

1. Given a valid future version, events select the version applicable to their explicit scope and occurrence time.
2. Given an old inspection, its stored engine/rules/evidence/input snapshots reproduce its original decision after later publication.
3. Given an urgent change within an existing effective window, a defined reviewed supersession procedure preserves history and avoids ambiguous activation; this requires additional design/implementation.

## Epic 4 — Inspection, remediation and release

### BAK-15 — Record trustworthy mass measurements

As a gate inspector, I want to capture ordered axle and gross masses with explicit units and origin so that an inspection uses reliable measurements.

**Priority/status:** P0 / Partial. **Sources:** PRD FR-B5,NFR-2; Brief §38. **Evidence:** manual input, numeric validation and Web Serial parser; device/calibration provenance incomplete. **Dependencies:** BAK-06,10.

Acceptance criteria:

1. Given manual input, decimal kilograms are validated; boolean, negative and nonfinite values cannot produce a decision.
2. Given gross/axle inconsistency, the operational capture policy reports a blocker; a software tolerance is never presented as a statutory tolerance.
3. Given serial input, source device, units, capture time and relevant calibration reference are inspectable. Physical device readings must pass witnessed field testing before being described as verified measurements.

### BAK-16 — Evaluate the current pre-dispatch inspection

As a gate inspector, I want a deterministic assessment of the current context, evidence, weights and attestations so that I know whether dispatch can proceed and why.

**Priority/status:** P0 / Foundation. **Sources:** PRD FR-B1,B2; Brief §§38,43,44 acceptances 3,4,10. **Evidence:** pure evaluator, inspection API, VersionedInspection UI, regulatory tests. **Dependencies:** BAK-06,10,11,13,15.

Acceptance criteria:

1. Given identical normalized input, context and exact ruleset/engine version, repeated evaluation yields the same control outcomes and decision; a matching retry returns the original attempt.
2. Given all applicable controls, the result distinguishes PASS, PASS_WITH_WARNINGS, HOLD, QUARANTINE and REVIEW_REQUIRED and records inputs, provenance and server time.
3. Given missing applicable configuration, the result records REVIEW_REQUIRED with an understandable configuration-required reason, never a guessed threshold or monetary penalty. Readiness percentage cannot authorize release.

### BAK-17 — Trace a failure to its source and corrective action

As a gate inspector, I want to open a failed control and see its source, expected condition and needed evidence/action so that I can correct the actual cause of the hold.

**Priority/status:** P0 / Partial. **Sources:** Brief §§35,44 acceptance 2; PRD FR-B1,G1. **Evidence:** result/source summaries shown; full registry/source navigation missing. **Dependencies:** BAK-09,13,16.

Acceptance criteria:

1. Given a failed inspection, the user can follow attempt → control → rule unit → exact source revision while retaining arrival/context identity.
2. Given a control detail, source kind/tier, provision, verification basis, version/effective dates, measured input and failure reason are visible.
3. Given a required document or remediation, the user sees the subject and next action; absent source information is explicitly missing rather than filled with generated text.

### BAK-18 — Resolve a hold through a fresh inspection

As a yard supervisor, I want to record corrective action and request re-evaluation so that a held truck becomes eligible only after its blocking conditions are resolved.

**Priority/status:** P0 / Partial. **Sources:** PRD FR-B3; Brief §§38,44 acceptance 6. **Evidence:** append-only re-evaluation and blocking gates; structured remediation record/UI missing. **Dependencies:** BAK-11,16,17.

Acceptance criteria:

1. Given HOLD/QUARANTINE, a normal release is denied and the operator can identify all blocking controls.
2. Given corrected load/evidence/context, remediation records who did what, when and supporting references, then creates a fresh inspection attempt.
3. Given the new attempt passes, gate eligibility derives from that attempt; the original failed attempt and remediation history remain inspectable.

### BAK-19 — Request a permitted exception

As a yard supervisor, I want to request an exception against a specific current inspection with a reason so that a second authorized person can assess only controls whose policy permits it.

**Priority/status:** P0 / Foundation. **Sources:** PRD FR-B3; Brief §§41,44 acceptance 7. **Evidence:** separate `OverrideRequest`, eligibility tests and UI. **Dependency:** BAK-16.

Acceptance criteria:

1. Given a current eligible blocking attempt, the request records requester, reason, time and the original attempt without changing its decision.
2. Given a NOT_ALLOWED blocker, missing mandatory attestation or invalid rating/evidence prerequisite, a request cannot bypass it.
3. Given a newer attempt or context, an old request cannot grant current release eligibility.

### BAK-20 — Make an independent exception decision

As an operations supervisor, I want to approve or reject an eligible exception requested by another person so that operational disposition has accountable independent review.

**Priority/status:** P0 / Foundation. **Sources:** PRD FR-B3,NFR-3; Brief §§41,44 acceptance 7. **Evidence:** `OverrideApproval`, server actor/role checks and tests. **Dependency:** BAK-19.

Acceptance criteria:

1. Given the requester or original inspector attempts approval, the server denies self-approval even if the UI action is forged.
2. Given an eligible independent reviewer, approval/rejection records actor, reason and time as a separate immutable record.
3. Given an approved request, original findings remain unchanged and release still checks freshness, current context/evidence/rules and every non-overridable blocker.

### BAK-21 — Release only under current gate authority

As a gate inspector, I want the server to authorize exit against the latest eligible inspection so that a truck cannot leave through stale approval or a changed browser status.

**Priority/status:** P0 / Foundation. **Sources:** PRD FR-A1,B3; SAD §9 as revised; Brief §§38,41,44 acceptance 6. **Evidence:** `backend/yard/services.py`, regulatory release tests. **Dependencies:** BAK-16 and BAK-18 or19–20 when applicable.

Acceptance criteria:

1. Given a current passing inspection or policy-permitted independent exception, the server reproduces the decision and rechecks evidence/reviews, effective rules and freshness before authorizing exit.
2. Given stale, revoked, superseded or foreign context/authority, release is denied; generic PATCH cannot grant COMPLETED, OVERRIDE_APPROVED or RELEASED authority.
3. Given successful exit, release authority, exit time, dwell, operational state, audit append and notification outbox event commit atomically; concurrent/repeated release cannot duplicate authority.

### BAK-22 — Generate a release-linked compliance passport

As a compliance officer, I want an inspectable passport for a completed release so that I can provide the exact decision and evidence basis to an authorized reviewer.

**Priority/status:** P0 / Planned. **Sources:** Brief §§38,41,44 acceptance 8. **Evidence:** release and inspection records exist; passport generation/view/export absent. **Dependencies:** BAK-12,14,21.

Acceptance criteria:

1. Given a recorded release, its passport references trip, vehicle, driver, controls, evidence revisions, approvals, exact ruleset/engine versions and timestamps.
2. Given an unreleased or ineligible truck, no completed-dispatch passport can be issued; a draft must be unmistakably labeled if provided.
3. Given later rule/evidence changes, the historical passport remains tied to the original release and is accessible/exportable only under authorized access.

## Epic 5 — Audit, exceptions and management evidence

### BAK-23 — Reconstruct and verify a gate decision

As a compliance officer, I want a chronological, exportable decision history with integrity verification so that I can explain who inspected, reviewed and released a truck.

**Priority/status:** P0 / Partial. **Sources:** PRD FR-B4,G1,NFR-4; SAD §6; Brief §41. **Evidence:** audit API/viewer/chain tests; full metadata envelope and complete export/verify UI missing. **Dependencies:** BAK-16,20,21.

Acceptance criteria:

1. Given an arrival, the audit view links context, inspection attempts, review/exception decisions and release actors/times.
2. Given tampering with any protected event field, canonical envelope verification detects it; concurrent legitimate appends do not fork the chain.
3. Given an authorized export/verification request, results identify their scope/version and failures without claiming blockchain, absolute immutability or authentication of source documents.

### BAK-24 — Respond to an operational exception

As a yard supervisor, I want a critical alert linked to a held/quarantined arrival so that I can acknowledge ownership and reach the underlying cause.

**Priority/status:** P0 / Partial. **Sources:** PRD FR-B3,F1; SAD §§9,10. **Evidence:** legacy quarantine alerts/ack API/UI; full versioned-attempt alert linkage needs validation. **Dependencies:** BAK-16,18.

Acceptance criteria:

1. Given a configured alert-worthy inspection failure, a correctly scoped alert links to its attempt and arrival without duplication on replay.
2. Given acknowledgement by an authorized user, identity/time are recorded; acknowledging the alert does not clear the gate blocker.
3. Given a revised inspection or release, alert resolution follows a defined policy while preserving the original failure and response history.

### BAK-25 — Deliver and escalate alerts reliably

As a facility manager, I want delivery attempts and overdue escalation to be visible so that a missing provider response does not silently hide a critical incident.

**Priority/status:** P1 / Partial. **Sources:** PRD FR-F1,F2; SAD §10. **Evidence:** notification outbox/commands/tests; deployed credentials, recurring runner and delivery validation incomplete. **Dependency:** BAK-24.

Acceptance criteria:

1. Given a committed event, notification dispatch happens outside the yard transaction and records per-channel attempt, result and deduplication identity.
2. Given unavailable/unconfigured WhatsApp, SMS or push, the interface distinguishes unavailable, simulated, queued and actually delivered states.
3. Given approved escalation intervals/recipients, overdue unresolved incidents escalate without resetting on retries; deployment includes a monitored runner and recovery test.

### BAK-26 — Explain shift performance from actual records

As a facility manager, I want dwell, throughput, queue and exception reports with drill-down so that I can investigate performance using the same records operators see.

**Priority/status:** P0 / Partial. **Sources:** PRD FR-A4,G2; Brief §§37,41,44 acceptance 13. **Evidence:** turnaround API/Reports; complete versioned decision metrics and occupancy-history utilization missing. **Dependencies:** BAK-08,21,23.

Acceptance criteria:

1. Given site/date filters, every metric reconciles to included records and exposes its definition, denominator, timezone and freshness.
2. Given absent dock history or incomplete periods, utilization is unavailable or qualified rather than fabricated.
3. Given export/drill-down, figures agree with the screen. Unsupported penalties, fines prevented and financial ROI are not presented as verified outcomes.

### BAK-27 — See the executive exception overview

As an executive, I want a read-only overview of yard state, blocked dispatches and changes so that I can identify what management should investigate within about ten seconds.

**Priority/status:** P1 / Partial. **Sources:** PRD FR-G2; Brief §37. **Evidence:** Reports and role gates; unified executive overview/record-derived risk drill-down missing. **Dependencies:** BAK-24,26,30.

Acceptance criteria:

1. Given a selected authorized scope, active-yard, dispatch, hold/quarantine and exception counts derive from shared records.
2. Given a metric or critical incident, the executive can inspect contributing records while remaining unable to mutate regulatory or gate authority.
3. Given a yard diagram or risk indicator, it is based on configured site state and stated definitions, without fake maps, live telemetry or invented financial exposure.

## Epic 6 — Extended regulatory operations

### BAK-28 — Prepare a cross-border dispatch

As a gate inspector, I want cross-border document requirements derived from the recorded corridor so that missing border evidence is found before dispatch.

**Priority/status:** P1 / Partial. **Sources:** Brief §§39,44 acceptance 3; PRD FR-B1,B2. **Evidence:** explicit route/jurisdiction selection and EVIDENCE controls; corridor content, deadlines and complete UI journey missing. **Dependencies:** BAK-06,11,13,16,22.

Acceptance criteria:

1. Given CROSS_BORDER and explicit traversed jurisdictions, only applicable published bundles/controls are selected.
2. Given missing jurisdiction configuration, the attempt is REVIEW_REQUIRED; configured missing/expired documents produce the specified outcome.
3. Given reviewed evidence and a fresh eligible evaluation, release/passport records all applicable corridor controls; deadlines operate only where implemented and source-supported.

### BAK-29 — Identify an abnormal-load review requirement

As a compliance officer, I want load dimensions/class and route context checked against configured abnormal-load requirements so that exceptional movements cannot pass under ordinary defaults.

**Priority/status:** P1 / Partial. **Sources:** Brief abnormal-load workflow and §43; upgrade plan phase8. **Evidence:** Load dimensions and ABNORMAL route context exist; dimension/permit rule operators and complete permit workflow absent. **Dependencies:** BAK-06,11,13,16.

Acceptance criteria:

1. Given load dimensions, units are explicit and incomplete information cannot imply an ordinary compliant movement.
2. Given an applicable permit/dimension requirement, a supported, tested control evaluates exact source-backed configuration; unsupported controls remain configuration-required.
3. Given a held exceptional movement, authorized permit evidence and a fresh inspection are required before policy permits release; no guessed clearance or permit threshold is used.

### BAK-30 — Review a proposed regulatory change and its impact

As a compliance officer, I want to inspect a proposed change and compare its effect before activation so that affected operations are understood without silently rewriting history.

**Priority/status:** P1 / Planned. **Sources:** Brief §§40,44 acceptance9; upgrade plan phase6. **Evidence:** publication/version primitives exist; Watch, change lifecycle and impact workflow absent. **Dependencies:** BAK-09,13,14,16.

Acceptance criteria:

1. Given a discovered/demo change, origin and status are explicit; generated extraction can create a proposal but cannot verify or publish itself.
2. Given an impact comparison, baseline/proposed version, input cohort and differences are inspectable; simulations do not mutate operational inspection results.
3. Given independent verification and activation, future events use the approved effective version and historical events retain their originals. Automatic live discovery requires separately approved sources/adapters.

### BAK-31 — Ask for an explanation of recorded state

As an authorized operator, I want a read-only assistant to explain recorded controls and evidence so that I can understand a hold without losing its provenance.

**Priority/status:** P2 / Planned. **Sources:** Brief §§44 acceptance11,48; proposed exception to old PRD §9. **Dependencies:** BAK-17,23,30.

Acceptance criteria:

1. Given a question, retrieval is tenant/site-scoped and answers cite actual records/source revisions with missing information identified.
2. Given an unverified load or source, the assistant reports deterministic state and uncertainty without inventing a legal conclusion.
3. Given a request to publish, approve, override or release, the assistant cannot perform it; every core workflow remains usable without an AI service.

## Epic 7 — Offline, integrations and operational readiness

### BAK-32 — Reconcile blocked offline work

As an operator with reconciliation permission, I want to inspect retained failed commands and resolve ownership/conflicts so that reconnecting never silently loses or reassigns work.

**Priority/status:** P0 / Partial. **Sources:** PRD NFR-1; SAD §7; current offline safeguards. **Evidence:** Dexie state/ownership/backoff and header counts; reconciliation UI absent. **Dependencies:** BAK-03,05.

Acceptance criteria:

1. Given permanent rejection, exhausted retries or unknown legacy ownership, the command remains saved with error/context and visible review status.
2. Given review, an authorized person may export or deliberately resolve/retry supported work; changing ownership or regulatory context is never an automatic conversion.
3. Given repeated sync, only accepted commands are removed; logout or site changes cannot replay someone else's pending work.

### BAK-33 — Assess offline with preserved rule versions

As a gate inspector, I want an explicitly provisional offline assessment using a trusted cached bundle so that I can continue preparation during outages without inventing live release authority.

**Priority/status:** P1 / Planned. **Sources:** PRD NFR-1; SAD §7 as revised; Brief §44 acceptance12. **Evidence:** versioned inspection currently online only. **Dependencies:** BAK-13,14,16,32.

Acceptance criteria:

1. Given authorized cached context/evidence and a reviewed bundle, its digest, effective window and engine/schema version are recorded with the offline capture.
2. Given a TypeScript evaluator, shared conformance vectors match the Python authority; missing/stale cache yields review-required, not pilot fallback.
3. Given reconnect, the original offline result/version survives and server reconciliation appends any needed reassessment. Offline live release requires a separately approved policy and is not granted by this story.

### BAK-34 — Consume N-ROK from an enterprise system

As a BAK IT integration operator, I want a scoped, versioned API for context submission and inspection results so that ERP/WMS/TMS workflows can use the gate without replacing their existing system.

**Priority/status:** P1 / Foundation. **Sources:** Brief §§47,49; SAD §11; PRD integrations. **Evidence:** authenticated regulatory APIs exist; external adapters, service credentials and complete contract documentation/UAT missing. **Dependencies:** BAK-06,13,16,21.

Acceptance criteria:

1. Given an integration identity, explicit scopes authorize only permitted tenant/site operations; retries bind operation key to normalized payload and ownership.
2. Given a result, decision, control findings, evidence requirements and exact versions follow a documented machine-readable contract; unsupported configuration is a real outcome.
3. Given provider timeout or duplicate delivery, state remains consistent and operational side effects are deduplicated. Adapter status is connected only after authenticated end-to-end evidence/UAT.

### BAK-35 — Run a coherent training scenario

As a demonstrator or trainer, I want an interconnected synthetic shift so that BAK can follow arrival, hold, remediation, independent review and release using consistent records.

**Priority/status:** P0 / Partial. **Sources:** PRD FR-H3,H5; Brief §§33,34,44 acceptance13. **Evidence:** existing seed/practice screens; canonical versioned scenario fixture missing. **Dependencies:** BAK-06,13,16–22,26.

Acceptance criteria:

1. Given the scenario, AFM1187, ABZ9901, ADP3357 and AEW7712 retain useful hold/dwell/exception concepts with linked vehicles, trips, evidence and audit history.
2. Given training source content, synthetic policies and unverified statutory references are labeled accurately; unavailable numerical law is configuration-required.
3. Given reset, only explicitly disposable demo data is affected; operational/versioned history cannot be deleted through seed/reset commands. All scenario metrics reconcile to those records.

### BAK-36 — Use the gate on a shared tablet or phone

As a gate inspector, I want readable, accessible controls on the devices used in the yard so that I can complete a shift accurately with limited connectivity and screen space.

**Priority/status:** P0 / Partial. **Sources:** PRD NFR-1,NFR-2; SAD §14; Brief §36. **Evidence:** mobile gate smoke check and PWA; low-end device/accessibility/extended outage proof outstanding. **Dependencies:** BAK-01,04,05,16,32.

Acceptance criteria:

1. Given the agreed phone/tablet viewports, critical forms fit without unintended horizontal overflow and status has text/shape beyond color.
2. Given keyboard/assistive navigation, labels, focus, errors and primary actions are usable with the approved touch-target standard.
3. Given a witnessed two-hour outage, supported arrival/draft workflows remain usable and reconcile safely afterward; online-only inspection/release limitations remain explicit. Measure bundle/runtime performance on target hardware.

### BAK-37 — Deploy without losing records or overstating readiness

As a platform operator, I want a recoverable release to durable storage with health/interface checks so that the deployed frontend and API represent the same tested system.

**Priority/status:** P0 / Partial; immediate rollout blocker. **Sources:** SAD §§13–15; PRD NFR-3,NFR-5,NFR-6; production findings. **Evidence:** startup migration fail-closed tests, production smoke workflow; Render still on old repository/ephemeral SQLite. **Dependencies:** approved data decision, deployment access.

Acceptance criteria:

1. Given the target database, inventory/backup and restoration proof precede migration; duplicate historical keys stop migration without deletion. Existing data is discarded only with explicit authorization.
2. Given release, persistent PostgreSQL, scoped origins/secrets, compatible frontend/API source revisions and migration success are verified; failed schema changes cannot start the application or seed demo users implicitly.
3. Given deployment, health, protected registry routes, CORS and authenticated golden paths pass before promotion; PostgreSQL race/load checks and backup recovery meet agreed operational gates. Target performance remains p95 reads under500ms at50 concurrent users until revised by evidence.

### BAK-38 — Export data and apply an approved retention policy

As a tenant administrator, I want scoped exports and a controlled retention/deletion process so that the organization can manage its data without accidentally erasing decision evidence.

**Priority/status:** P1 / Partial. **Sources:** PRD NFR-6; SAD tenancy/audit; Brief evidence/security. **Evidence:** selected CSV exports and protected regulatory references; full tenant export/deletion workflow absent. **Dependencies:** BAK-12,22,23,37.

Acceptance criteria:

1. Given an authorized export, tenant/site scope covers operational records and their linked decision/evidence history without leaking another tenant's data.
2. Given a deletion request, the approved retention/legal-hold policy determines permitted action; ordinary deletion cannot cascade through protected inspection/release evidence.
3. Given an executed retention/deletion action, scope, authorization and outcome are auditable; irreversible deletion receives explicit confirmation. No statutory retention period is invented.

## Deferred Trucki backlog

These capabilities preserve PRD coverage but do not block the BAK gate increment. Existing backend code is not evidence of an integrated, deployed user journey.

| ID | User story | Sources | Proposed acceptance boundary | Status/priority |
| --- | --- | --- | --- | --- |
| TRK-01 | As a fleet dispatcher, I want to maintain vehicles/drivers and assign a confirmed trip so that the right resources perform it. | FR-C1,C2,C4 | Valid lifecycle transitions only; scoped mutation roles; assignments agree with regulatory context; authorization negative tests. | Partial/P2 |
| TRK-02 | As a fleet owner, I want estimated versus actual costs and revenue so that I can understand trip margin. | FR-C3,G3 | Costs have explicit currency/units and source records; report reconciles; a paid status does not imply a processed payment. | Partial/P2 |
| TRK-03 | As a driver, I want to accept work and send status/location/SOS through the supported channel so that dispatch knows my last reported state. | FR-D1,D2,D3,F3 | Authenticate sender; enforce trip ownership; label last-known timestamp/source; deduplicate retries; offline sync preserves ownership. | Partial/P2 |
| TRK-04 | As a dispatcher, I want last-known trip positions and vehicle suggestions so that I can plan without mistaking recommendations for gate clearance. | FR-C5,C6 | Position freshness/source visible; recommendations use identified assumptions and never grant regulatory release; no fake telemetry. | Partial/P2 |
| TRK-05 | As a customer, I want to request transport and track my booking reference so that I can follow the agreed service. | ModuleE | Scoped customer token; no unrelated customer/driver disclosure; quote/booking confirmation traceable; public surfaces reviewed separately. | Partial/P2 |
| TRK-06 | As a tenant owner, I want billing/payment state and preferred language support so that the service can operate commercially for my team. | PRD R3,NFR-7 | Payment provider and reconciliation designed before paid claims; approved plan/price; English plus separately accepted translations. Split into implementation stories before scheduling. | Planned/P2 |

## Recommended slicing and dependency order

| Slice | Outcome to demonstrate | Stories | Exit evidence |
| --- | --- | --- | --- |
| S0 — Safe deployment | Same source revision, durable data, honest live/practice state | 01–04,37 | Backup/restore and migrations; protected API/CORS; two-tenant/site denial; shared-device refresh/sign-out |
| S1 — Domestic gate | Arrival/context → evidence/ratings → inspection → hold/remediation → fresh inspection → release | 05–08,09–13,15–21,24,32,36 | Authenticated full-stack success and blocked scenarios; no self-approval/status bypass; real operator walkthrough |
| S2 — Defensible release evidence | Traceable sources/files/audit → passport → reconciled report | 12,14,17,22,23,26,35 | Inspectable/exportable passport; source drill-down; complete hash-envelope tampering checks; metric reconciliation |
| S3 — Corridor and management | Cross-border/abnormal context plus reliable alerts and overview | 25,27–29 | Second golden path; absent configuration blocks; operational notifications/device evidence |
| S4 — Change and reuse | Proposed change → impact → publication; enterprise contract; offline assessment | 30,33,34,38 | Version transition/history proof; adapter UAT; Python/TypeScript conformance; approved retention |
| S5 — Optional intelligence and fleet | Read-only explanation and demand-led fleet increments | 31,TRK-01–06 | Retrieval authorization/safety; agreed customer need and release acceptance |

These are delivery slices, not calendar sprints or effort estimates. Some P0 work spans S1/S2; a credible operational pilot is not complete after S1 alone. Blocked prerequisites do not justify labeling missing behavior as complete.

## Traceability to the master brief acceptance scenarios

| Brief §44 acceptance | Stories | Present proof/gap |
| --- | --- | --- |
| 1 Existing product survives | 01,05,07,08,36,37 | Practice UI tests exist; coordinated upgraded production regression remains |
| 2 Regulatory traceability | 09,13,17,23 | Snapshots/source summary exist; complete drill-down missing |
| 3 Contextual applicability | 06,16,28,29 | Context and evaluator tests exist; actual corridor/abnormal coverage missing |
| 4 Determinism | 16,14 | Pure evaluator and normalized replay tested with synthetic controls |
| 5 Versioning | 13,14 | Historical snapshots/future-version tests; in-window supersession design open |
| 6 Quarantine/remediation | 18,21,24 | Server blocking/re-evaluation foundation; structured remediation/complete UI open |
| 7 No self-approval | 19,20 | Separate actor-bound requests/approvals with negative tests |
| 8 Passport | 22 | Not implemented |
| 9 Regulatory Watch | 13,30 | Independent publication exists; Watch/change/impact absent |
| 10 No fake law | 04,09,10,13,16,35 | Missing configuration blocks; no law/source activation supplied |
| 11 Copilot safety | 31 | Copilot absent; requires retrieval-only acceptance |
| 12 Offline version integrity | 32,33 | Owned outbox exists; offline regulatory evaluator/bundle absent |
| 13 Dashboard integrity | 08,26,27,35 | Real-read demo fallback removed; full metrics/fixture reconciliation open |

## Definition of done for an individual story

An implementation story is complete only when its stated acceptance criteria pass, its authorization and failure paths are tested, the relevant UI/API journey works together, and documentation records limits. For gate-critical stories include tenant/site denial, actor independence where relevant, stale-context/version rejection and retry/concurrency behavior. PostgreSQL concurrency must be proven on PostgreSQL, not inferred from SQLite tests.

Regulatory tests may use clearly synthetic INTERNAL_POLICY fixtures. Operational statutory activation additionally requires actual source/document review and approved workflow configuration. Interface smoke tests alone establish neither statutory correctness nor end-to-end gate readiness.

Record **code implemented**, **integration accepted**, **deployed**, and **field accepted** separately. Do not mark the entire story Done because a model or endpoint exists.

## Decisions needed from BAK before operational acceptance

1. Confirm facility SOP, authorized inspectors/reviewers/release roles, dock allocation exceptions and inspection freshness.
2. Provide approved source documents/interpretations, manufacturer ratings, actual corridors/cargo classes and required evidence ownership.
3. Approve exception prohibitions, remediation recording, warning-release policy and any future offline authorization policy.
4. Confirm document access/retention, identity provisioning and ERP/WMS/TMS integration ownership.
5. Resolve current pilot-data preservation and durable deployment before a backend cutover.
6. Agree target devices, performance/load conditions and which BAK staff will witness the domestic/cross-border acceptance journeys.

These decisions gate operational acceptance, not drafting or implementing safe scaffolding. No assumed pricing, signed procurement, verified law or production readiness is introduced by this backlog.
