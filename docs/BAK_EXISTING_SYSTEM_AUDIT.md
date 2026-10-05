# BAK existing system audit

Date: 5 October 2026. Baseline: Git HEAD `d00c28e`. Scope: tracked application source, local directory inventory, provided BAK INTEL brief, configuration, migrations, tests and an isolated API reproduction. This is an as-built audit, not a regulatory certification or deployment attestation.

Post-audit stabilization has since been implemented in the working tree. Findings below describe the baseline; consult [implementation progress](BAK_IMPLEMENTATION_PROGRESS.md) for fixes, remaining gaps and rollout constraints.

## Decision

Preserve and extend this repository. It contains a useful BAK-derived yard PWA and a substantially implemented Django backend. It is not yet the regulatory operations platform described in the new brief, and it is not ready to authorize real-world regulatory release without remediation.

The immediate problem is authority and evidence, not a shortage of dashboard pages. Resolve the release bypasses, configuration trust, historical decision integrity, offline identity and misleading live/demo presentation before adding regulatory intelligence, passports or AI.

The current directory was deliberately repositioned toward Trucki immediately before this audit. `docs/PRD_v2_Trucki.md` states that the BAK pilot closed on 4 October; the new user instruction says BAK is back in play. That prior closure statement is historical context, not the current strategic mandate. It also is not proof that renewed interest is a purchase, approved pilot or signed deployment agreement.

## Evidence and limitations

- Initial working tree was clean. 218 tracked files were inventoried before audit additions.
- No applicable AGENTS.md was found in the inspected repository source tree.
- Secret directories and local environment values were not read or printed. Tracked environment templates and configuration were inspected. A historical secret scan was not performed.
- No production credentials, live regulator service, ERP/WMS, hardware, or deployed environment was exercised.
- API findings below were reproduced using `docs/audit/reproduce_findings.py`, which replaces the database with SQLite `:memory:` before Django setup. Existing local databases were not modified by those probes.
- SQLite tests do not validate PostgreSQL row locking, races or production concurrency. Browser test execution is recorded separately below; no visual usability or accessibility certification is claimed.
- References to statutes in code/specs are claims to verify. This audit did not establish their current legal validity or numerical schedules. The implementation brief is a requirements input, not an instruction to activate assumed law.

## A. Existing architecture

### Runtime and dependencies

| Concern | Discovered implementation |
| --- | --- |
| Frontend | React 19.2.8, React DOM 19.2.8; Vite 8.2.2; React Router DOM 7.18.3. Versions in package manifest/local baseline. |
| Language/build | TypeScript ~6.0.2; project references in `web/tsconfig.json`; app ES2023, bundler module resolution, noEmit, unused-variable checks. `strict` is not enabled. |
| Styling | Tailwind 4.3.3 plus custom CSS tokens/components; Oxlint configuration includes React/TypeScript rules. |
| State | Zustand session; route-level React state; REST subscription/poll adapters. No shared canonical operational store for the practice flow. |
| API | Django/DRF. Local virtualenv: Django 6.1.1, DRF 3.18.1, Python 3.14.2. Requirements allow Django >=6,<7 and DRF >=3.17,<4; backend dependency versions are not locked. |
| Persistence | Django ORM; PostgreSQL through DATABASE_URL; SQLite fallback. Existing migrations in core, yard, trip and whatsapp. |
| Client persistence | IndexedDB/Dexie outbox; legacy localStorage migration; localStorage API token; sessionStorage practice identity. PowerSync SQLite code remains alongside REST. |
| PWA | Workbox injectManifest worker, precached shell/assets, NetworkFirst API cache, push handlers, immediate worker activation. |
| Auth | Django token/session authentication; server PIN exchange; REST role/tenant/facility checks. Old Firebase identity helpers remain in alternate modules. |
| Notifications | Transactional outbox and notification logs; management command drain; Twilio and VAPID adapters. Configuration does not prove delivery. |
| Tests | pytest/pytest-django, Vitest, Playwright demo/live suites. |

The runtime path for a real yard session is `App.tsx` -> session/live gate -> `api.ts`/`live.ts` -> Django `/api/` -> core/yard/compliance/trip -> ORM. The separate `powersync/` connector expects Firebase bearer tokens and endpoints absent from the current Django URL table. `initPowerSync` has no application bootstrap call, but Alerts imports its operations for practice behavior, so it is not wholly dead code.

The service worker and backend have independent identity/data concerns. A configured API URL is labeled LIVE; that means configured access, not continuously verified connectivity. Real feed failures are logged once and do not consistently produce visible stale/error states.

### Directory reality

| Location | Current meaning | Audit recommendation |
| --- | --- | --- |
| `web/` | Active yard PWA; BAK visual tokens with Trucki naming | Keep path and working routes; extend incrementally. |
| `backend/` | Active Django API and fleet/yard domains | Keep; add reusable regulatory domain without replacing the platform. |
| `docs/PRD_v2_Trucki.md`, `SAD_v2_Trucki.md` | Previous active Trucki roadmap and merged architecture spec | Retain as dated lineage; explicitly separate from renewed BAK requirements. |
| `docs/archive/` | Older BAK specs, proposal, meeting material | Preserve evidence; do not bulk restore them as current specifications. |
| `docs/reference/events/`, `wms/` | Retired TypeScript implementation references, including tests | Reference only; excluded from current app/test pipeline. Not a connected integration. |
| `server/`, `functions/` | Local build/dependency remnants; no tracked source in current HEAD | Inventory and retire later; no deletion during audit. |
| `spotterAI/` | Ignored vendor/project remnant; observed nested backend | Inspect ownership before any cleanup; do not graft a second application back in. |
| `.secrets/`, `.vercel/`, local env/DB files | Local private/deployment artifacts | Keep private; deployment linkage is not evidence of an active approved BAK environment. |

Recent history: `2f16bba` archived BAK-era documents; `d00c28e` migrated/cleaned the tree toward TruckLink/Trucki, retired Node/Firebase/vendor tracked paths and retained events/WMS as references. Folder names alone therefore misrepresent executable architecture.

## B. Routes, components and navigation

All routes use lazy imports and BrowserRouter. Existing paths should survive.

| Route | Current screen | Role gate |
| --- | --- | --- |
| `/` | Practice/real sign-in | Public entry |
| `/queue` | Arrival registration, shift queue, check links, release | Dispatch, operations, facility |
| `/docks` | Dock state and assignment | Operations, facility |
| `/compliance` | Three axle weights/GVM, checklist, serial input, quarantine override controls | Dispatch, operations, facility |
| `/alerts` | Alerts, acknowledgement, override affordance, push | All six roles; actions differ |
| `/reports` | Turnaround/wait/status, CSV, legacy analytics sections | Operations, facility, executive, admin |
| `/audit` | Audit records | Compliance, admin, executive, facility |
| `/admin` | Demo yard setup and onboarding instructions | Admin |
| `/hub` | Role overview | All six roles |
| `/guide` | Training workflow | All six roles |

Roles: DISPATCH_SUPERVISOR, OPERATIONS_SUPERVISOR, FACILITY_MANAGER, EXECUTIVE, ADMIN, COMPLIANCE_OFFICER. Frontend gates are UX controls; `backend/core/rbac.py` plus tenancy helpers provide real enforcement on yard endpoints. Matrices differ in places: facility manager sees override actions but compliance update API allows only operations/admin; compliance officer cannot open the compliance screen. Regulatory reviewer authority does not exist yet.

Reusable design: `components/Layout.tsx`, `components/ui.tsx` (headers, sections, status pills, stats, empty states), `index.css`, `lib/status.ts`. Midnight navy, amber signals, paper surfaces, table/card layouts, status symbols, touch targets and role-aware navigation form a recognizable BAK industrial identity. Trucki naming did not erase the CSS identity. Keep these assets; verify tablet/desktop/accessibility behavior during implementation instead of proposing an aesthetic rewrite. Template assets and `routes/Placeholder.tsx` remain cleanup candidates.

## C. Domain and functionality worth preserving

| Domain | Actual model/behavior | Target gap |
| --- | --- | --- |
| Company/site | Organisation; Facility with timezone/config; UserProfile facility membership | Explicit selected site/session context, lifecycle constraints and service identities |
| Vehicles | `trip.Vehicle`: org-scoped plate, make/model, fuel/service fields | Axle topology, masses, jurisdiction, regulatory class, certificates |
| Drivers | `trip.Driver`: optional user link, licence/expiry, rates | Eligibility/evidence and dispatch references |
| Cargo/load | Queue cargo text; trip commodity/load fields/cargo_items JSON | First-class load with dimensions, units and evidence |
| Trips | Vehicle/driver FKs, origin/destination, booking/cost/status/location/image functionality | Yard queue has no trip/vehicle/driver FK; fleet and yard remain disconnected |
| Yard/queue | QueueEntry stores plate/driver text/cargo/destination, status, dock, entry/exit/dwell, idempotency | Arrival -> load/trip -> gate context linkage; separate operational vs regulatory decisions |
| Docks/equipment | Occupancy/current entry/capacity; equipment schema; assignment endpoint | Concurrency invariants, coherent seed relationships; equipment API/UI incomplete |
| Compliance | Pure Python/TS mass validators; config by route/vehicle; checks and quarantine transaction | Sources, applicability, versioned rulesets, immutable input/result snapshots, unknown/config-required decision |
| Alerts | Severity/category/related queue, acknowledgement actor/time | Control/evaluation references, computed dwell alerts and delivery visibility |
| Overrides | Requester, inspector and authorizer; dedicated endpoint rejects requester/inspector approving | No per-rule policy; original status mutated; incomplete request metadata; generic PATCH bypass |
| Reports/export | Row-derived wait/turnaround/status metrics; queue CSV client/server; audit CSV/verify | Unified records, stale status, formula-safe CSV, regulatory exception metrics/passports |
| Offline | Queue/compliance write outbox with retries and replay keys | Actor/site scoping, retention/dead-letter, local verified evaluations, ruleset/time integrity, dependency ID mapping |
| Device input | Web Serial ASCII parser fills gross weight | Device identity, signed/calibrated provenance, unit/sign/decimal rigor and axle measurements |

Existing statutory behavior is deterministic arithmetic, not contextual legal applicability. Route/type lookup is useful scaffolding but does not evaluate registration jurisdiction, operation, cargo dimensions, customs status or documents. Current decisions combine PASS/FAIL with yard check statuses; new regulatory decisions must be separate from the operational queue FSM.

No implemented ROU, REU, RegulatorySource, RuleSetVersion, EvidenceRecord, CompliancePassport, Regulatory Watch review/impact workflow, regulatory API or Copilot was found in current source/routes/models. Trip images exist but are not a verified evidence vault.

Backend fleet/booking/routing/WhatsApp APIs remain registered even though the current web shell has no equivalent fleet screens. US-HOS calculation remains imported and used in `trip/views.py` despite SAD claiming it was dropped. Its assumptions must not flow into Zimbabwe/SADC regulatory decisions. Preserve historical code where useful; disable unrelated routes deliberately only after consumer inventory.

## D. Prioritized findings

Severity means implementation/remediation priority. CONFIRMED = reproduced in isolated API probes; STATIC = direct code evidence; RISK = needs dedicated runtime/concurrency/browser validation.

### P0 — Release and decision authority

**F01 CONFIRMED: generic queue status PATCH bypasses quarantine approval.** `backend/yard/views.py:151`, `yard/serializers.py` and `compliance/engine.py` permit QUARANTINED -> PENDING_OVERRIDE -> OVERRIDE_APPROVED -> RELEASED with a single authorized operations user. No check/second approver/evidence is required. Probe reaches RELEASED with no ComplianceCheck and no exit timestamp. PATCH also permits AT_DOCK -> COMPLETED without running the compliance gate. The dedicated release endpoint trusts the status, not a valid current evaluation. Fix by removing critical status writes from generic PATCH, introducing command services and checking authoritative evaluation/release evidence under row locks.

**F02 CONFIRMED: callers supply their own regulatory limits.** `backend/compliance/views.py:125` prefers payload limits; `compliance/serializers.py` accepts them. Probe produces PASS for 60,000kg using caller-inflated axle limits/GVM. The normal web adapter does not send limits, but direct API clients can. GVM is also caller input without evidence binding. Resolve published configuration server-side; capture measurement and rated mass provenance; allow arbitrary thresholds only in isolated demo/test contexts explicitly labeled unverified.

**F03 CONFIRMED: mandatory checklist is enforced only by the UI.** Server decision evaluates weights/GVM and stores arbitrary checklist metadata. False driver-license metadata still produces PASS, and the web submit adapter omits checklist answers entirely. Establish server-side evidence requirements and fail-closed missing/failed controls.

### P1 — Regulatory credibility and integrity

**F04 STATIC: unverified defaults become live decisions and fine claims.** Python/TS tables fall back to pilot limits; seeds write these as `is_active=True`. `FEE_PER_KG_USD=0.50` produces values called fines in alerts/audit/notifications. Source text, provisions, effective dates, reviewers and rule versions are absent. Unknown routes/types normalize/fall back to DEFAULT instead of producing review/configuration required. `LEGACY_DEMO_UNVERIFIED` does not exist yet. Stop representing these as verified statutory controls.

**F05 STATIC: historical evaluations are not reproducible regulatory records.** Checks store some derived axle results, input mass and mutable status, but no event snapshot, source version, ruleset digest or applicability reasons. ComplianceConfig updates overwrite the active table. Override transitions mutate the same check, and request reason is only in audit payload until approval records a reason. Use immutable evaluation, separate override events, timestamped versions and explicit activation history.

**F06 CONFIRMED: replay lookup crosses facility authorization boundary.** `backend/compliance/views.py:108` searches organisation+client_key after checking the submitted entry's access. A facility B-only user can submit their own entry with an A check's key and receive A's result within the same organisation. This is not a demonstrated cross-organisation leak. Bind replay to facility, actor/permission scope, operation and payload; reject incompatible reuse. Database uniqueness for check client_key is absent, so race duplicates are a separate risk.

**F07 STATIC: offline queue can lose work and attribute it to the wrong session.** `offline/db.ts:152` deletes after five failures; queue has no owning org/facility/actor. `flushPendingActions` replays with the currently signed-in token. Original occurrence time, ruleset/evaluation and dependency mappings are absent. A queue create returns void, so later offline checks cannot reliably reference a newly server-assigned arrival ID. A 5s timer can overlap flushes. Keep durable blocked actions/dead letters; serialize replay; scope by identity/site; reconcile IDs and preserve original timestamps.

**F08 CONFIRMED: facility reset deletes org-wide config.** `backend/yard/views.py:622` deletes ComplianceConfig by organisation when resetting one facility. Sibling facilities lose shared rules; live evaluations then fall back to bundled pilot tables. Separate demo tenants/configuration, prohibit reset on production datasets and preserve evaluation/evidence history.

**F09 CONFIRMED: audit hash omits audit metadata.** `core/audit.py:36` hashes previous_hash+payload+salt, not action, actor, timestamp or facility. Probe changes action/actor_ref with QuerySet.update and verify_chain still returns ok. Model save/delete guards are not database immutability; ORM bulk operations/direct database access can bypass them. Hash a canonical complete event envelope, use append-only DB permissions/constraints, preserve old algorithm/version and verification limits. Existing SHA-256 chain is implemented; HMAC, non-repudiation and an immutable ledger are not guaranteed.

**F10 RISK: operational mutations race.** Dock occupancy and queue/compliance/release/override preconditions are read before atomic blocks without select_for_update on those rows. Transaction.atomic alone does not serialize competing requests. Add PostgreSQL concurrency tests, locks and constraints (single occupancy, valid relationship, replay uniqueness). Do not infer concurrency safety from SQLite passing tests.

**F11 STATIC: LIVE screens initially contain demo records and fake live utilization.** Queue/Alerts/Docks/Reports initialize from seeds even in live mode. Failed polling can leave seeds under a LIVE header. `DockBoard.tsx:27` assigns 82% to every occupied live dock and 40% to available docks; this is fabricated utilization. Use empty/loading/error/stale states and record-derived occupancy/dwell metrics. Connected/configured/live freshness are different states.

**F12 RISK: shared service-worker cache has no auth/session isolation.** `web/src/sw.ts:27` caches `/api/` GET reads under a shared cache with a 24h cap. No tenant/actor namespace or logout purge appears. Verify deployed response cache headers, Workbox behavior and offline user-switch flows; prevent private response reuse across identities. This is a source-established risk, not a demonstrated browser data leak.

**F13 CONFIRMED: legacy public registration joins default organisation.** `trip/serializers.py:27` attaches registrations to slug default and profile default role OPERATIONS_SUPERVISOR (`trip/models.py:116`). No facility is assigned, so this does not by itself bypass yard facility checks. It can expose org-scoped legacy fleet reads if real data uses default. Replace with scoped invites/customer identities or disable the legacy registration surface after dependency inventory.

**F22 CONFIRMED: unaffiliated fleet writes select the first organisation.** `trip/views.py` vehicle/driver create paths use `get_user_organisation(...) or Organisation.objects.filter(is_deleted=False).first()`. IsAuthenticated is the only create permission. The eighth probe creates a Vehicle inside the first active organisation using an authenticated user with no profile/organisation. This is a demonstrated tenant write boundary failure; yard isolation tests do not cover it. Remove all first-org fallbacks and apply explicit fleet command permissions. Same-org non-admin CRUD also needs role-policy review.

### P2 — Delivery, maintainability and UX

**F14 STATIC: CI is not reproducible from declared backend dependencies.** Workflow installs requirements.txt then calls pytest, but neither pytest nor pytest-django is declared. Local .venv has both, hiding the clean-run problem. Separate and lock runtime/dev requirements. CI uses Node 20; local baseline is Node 24.12.0. Installed Vite supports ^20.19.0 or >=22.12.0, so the manifest does not establish a Vite incompatibility; nevertheless align supported runtime explicitly. Frontend lockfile exists.

**F15 STATIC: deployment artifacts disagree.** Render API+Postgres blueprint is the current documented path; backend Vercel/Procfile/build/prestart alternatives remain. Render CORS is `trucki.vercel.app`; production smoke target is `trucki-two.vercel.app`; wrong origin can block real API use. Settings default to CORS_ALLOW_ALL_ORIGINS=True when origins are omitted; .env example incorrectly says default False. RENDER missing-secret fallback is not production fail-closed. Production proxy/TLS/cookie controls need deployment verification, not unsupported claims.

**F16 STATIC: notification implementation lacks a scheduled runner in blueprint.** Outbox/drain command exists; render.yaml has no worker/cron and gunicorn does not invoke the command. UI promises 10/30m escalation, but deployment execution is unproven. Runner concurrency/deduplication also needs tests. Uncredentialled delivery is logged, not sent.

**F17 STATIC: old data/identity implementations inflate bundle and diverge.** PowerSync, Firebase auth/Firestore rules, legacy PIN, analytics bearer-token client and multiple isLive helpers remain after REST cutover. Analytics routes it expects are absent in Django. Build emits a 585kB Firebase chunk, several SQLite WASM assets (~1.1–2.5MB each) and worker assets. Reference tests are not run. Consolidate actual consumers before dependency deletion.

**F18 STATIC: practice workflow is disconnected and sometimes claims success.** Route-local registration/check state does not update one shared demo dataset. Reports has its own seeds/timestamps; dock occupants/queue notes disagree; backend seed omits released q5 and creates override/quarantine statuses without supporting checks/approvers. Alerts catches failed PowerSync approval, still marks success and says recorded in audit. Practice release calls the live release adapter. Build a deterministic shared fixture/store and emit actual demo audit/evaluation events.

**F19 STATIC: privilege/UI and session inconsistencies.** Facility manager override affordance fails against API RBAC. RoleGuard Switch role calls local signOut only, leaving stored token for AuthRestore; normal Layout sign-out clears the live token. Site is build-time VITE_FACILITY_ID instead of authenticated selectable site. Align actions/permissions and use one logout/site-context contract.

**F20 STATIC/RISK: measurement/export rigor.** Serial parser removes sign and decimals and infers stable for unmarked KG lines. Manual total is not cross-checked with axle sum; NaN/Infinity input behavior requires tests. No durable calibrated-device metadata captured. CSV quoting does not neutralize spreadsheet formula prefixes in user-controlled cells. Fix before operational measurements and external CSV exports become trusted evidence.

**F21 STATIC: docs/package contract drift.** web README is template text; backend package.json contains npm dependencies named for Python packages and assessment branding; OpenAPI/Firestore/environment references do not form one current API contract. Trip HOS logic contradicts dropped scope; no generated OpenAPI synchronization gate, backend lint/typecheck or PostgreSQL CI job found. Document migration history instead of suggesting retired Node/Firebase services are current.

## E. Regulatory assumptions currently embedded

| Assumption/value | Locations | Disposition |
| --- | --- | --- |
| Three-axle default 8000/9000/9000kg; tanker middle axle 8000; refrigerated front 7500 | `validation/siTables.ts`, Python engine, tests, UI defaults, seeds | LEGACY_DEMO_UNVERIFIED; no verified source schedule found |
| All corridor tables initially identical; unknown context falls back to DEFAULT | Same resolvers | Unsupported applicability; require context/configuration |
| USD 0.50/excess kg | engine.py, powersync/operations.ts, demoData SI cards, docs, notifications | Unverified penalty assumption; never represent as statutory amount until sourced |
| ~$945 incident; $20 reweigh, $25 RT16, $20/day storage, ~$150 decanting; $6200 pilot, seven prevented incidents pay back | demoData, Reports, Trucki PRD | Commercial/demo assumptions; not actual savings or regulator feed |
| S.I. 129/2015 plus 159/2022 cited as legal basis | Code/comments/specs | Reference metadata only pending verification |
| New brief mentions S.I. 118/2023 instead of legacy 159/2022 | New brief | Resolve instrument/provision relationship; do not silently substitute |
| Three weights and editable 24000kg GVM; total independent from axle sum | Compliance UI and API | Measurement/rating config lacks authority/provenance |
| >60m dwell; 10/30m escalation; fixed dock percentages | Reports/seeds/notify/DockBoard | Operational policies/illustrations, not law; separate from regulatory rules |
| US hours-of-service | hos_engine.py and trip planner | Legacy unrelated engine; not Zimbabwe/SADC regulation |

No verified statutory source documents, signed review records, instrument hashes, rule activation approvals or reproducible source-to-rule mapping were found in tracked runtime. Not every input needs a statutory source: distinguish vehicle manufacturer ratings, internal operating policy and law explicitly.

## F. Testing performed and coverage gaps

| Check | Result on this checkout |
| --- | --- |
| Backend pytest `-m "not live" -q` | 567 passed, 8 deselected, 214 warnings; 148.84s. Existing local .venv. |
| Frontend `npm run test` | 55 passed in 11 files; Vitest 5.0.0. |
| Frontend `npm run lint` | Passed with one Fast Refresh export warning in ui.tsx. |
| Frontend `npm run build` | Passed incl TypeScript and PWA; large chunk and deprecated build-option warnings. |
| Django `check` | No issues. |
| Django migration drift `makemigrations --check --dry-run` | No changes detected. |
| Django `check --deploy` | HSTS, SSL redirect, session/CSRF secure-cookie warnings; weak-key warning caused by intentionally short audit-only env value. Production settings not attested. |
| Isolated audit probes | Eight issues confirmed; script and reproduction instructions retained. |
| Playwright demo | 15 passed in 38.4s after sandbox browser-spawn restriction was resolved; no retries on successful run. |
| Live/production/hardware/Postgres concurrency | Not run; explicitly outside evidence of passing local suite. |

Present coverage: mass validation/resolution, roles/tenancy, audit chain, notifications, yard API/schema, reports/admin, local outbox, serial parsing and fleet functions. The current 567/55 pass counts do not establish the new brief's acceptance criteria.

Missing or insufficient: generic status bypass, caller-controlled rules, required checklist server enforcement, facility replay mismatch, duplicate/racing requests, stale approval of older check, offline account switch/data retention, private cache isolation, canonical audit metadata hashing, source verification/activation, ruleset snapshots/effective dating, contextual applicability, unknown data, evidence expiry, immutable overrides, release-to-passport linkage and integrated shared demo paths. New regulatory modules have no existing tests because they do not exist.

## G. Acceptance status against the supplied brief

| Acceptance | Audit status |
| --- | --- |
| 1 Existing product survives | Core source retained; baseline passes; browser evidence subject to validation limitation |
| 2 Traceability | Missing source/ROU/version chain |
| 3 Applicability | Route/type lookup only; target not implemented |
| 4 Determinism | Arithmetic deterministic; full versioned regulatory decision absent |
| 5 Versioning | Missing |
| 6 Quarantine | Dedicated path exists; generic status bypass defeats guarantee |
| 7 No self approval | Dedicated API checks it; bypass path defeats end-to-end guarantee |
| 8 Passport | Missing |
| 9 Human regulatory change review | Missing |
| 10 No fake law | Fallback/penalty claims fail requirement |
| 11 Copilot safety | No Copilot implemented |
| 12 Offline version integrity | Missing ruleset/event identity |
| 13 Dashboard integrity | Some row-derived metrics; fabricated utilization and disconnected seeds fail full requirement |

## H. Next work

See `BAK_REGOPS_UPGRADE_PLAN.md` for keep/refactor/extend decisions, concrete files, migrations and gated phases; `BAK_DIRECTORY_AND_PRODUCT_STRATEGY.md` for product/directory decisions. This audit adds documents and an isolated reproduction tool only. It does not change application behavior, move/delete historical files, install services or deploy anything.
