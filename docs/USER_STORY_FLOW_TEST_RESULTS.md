# User-story flow validation — 6 October 2026

Scope: [BAK user stories](BAK_USER_STORIES.md), current checkout based on `0227260` with local test/fix changes. Tests distinguish real browser/API journeys, in-process API/service tests, practice flows and deployed smoke checks. A passing subset does not make the entire story Done.

## Executed checks

| Layer | Result | What this proves |
| --- | --- | --- |
| Regulatory/gate/tenant/audit backend suites | 85 passed | Synthetic authority, versioning, replay, tenant/site isolation and current audit-chain behavior |
| Yard API plus inspection-context refresh regression | 39 passed | Existing yard commands/reporting and retrieval of a recorded attempt after navigation |
| Frontend unit suites | 62 passed, 12 files | Includes ownership/replay, equal-timestamp FIFO regression and v2→v3 pending-record preservation |
| Existing Chromium practice suite | 15 passed, retries disabled | Six-role training navigation, registration, checks, dock/alert affordances and report export |
| New real Chromium→Django story suite | 4 browser journeys passed; pytest wrapper/database assertions passed (54.23s) | Non-mocked journeys described below; fixture database is disposable |
| Deployed frontend/API smoke | 7 passed, 1 failed, retries disabled | Gate/mobile/practice/navigation/refresh pass; regulatory registry GET returns404 |
| Lint and TypeScript/production/PWA build | Passed | Existing Fast Refresh, bundle-size and deprecated PWA option warnings remain |

Production target: `https://trucki-qgld1o9z7-brandontinozs-projects.vercel.app`; API: `https://spotteraiassessment-khaj.onrender.com`. `/api/health/` responded successfully, but `/api/regulatory/sources/` returned404 instead of a protected401/403 response. Therefore the deployed app cannot currently demonstrate the new regulatory journey. Production checks were read-only; no real inspection, source publication, approval, release or reset was performed.

The new full-stack harness uses pytest `live_server`, real token login, the actual React routes and a migrated file-backed temporary SQLite test database. Policy/rating documents and thresholds are explicitly synthetic INTERNAL_POLICY fixtures, not verified law. Setup uses backend domain services because configuration/context authoring screens do not yet exist; this does not count as acceptance of those authoring UI stories. No production or existing local database is migrated by the harness.

## New executable journeys

| Journey | Story coverage | Assertions |
| --- | --- | --- |
| Passing inspection → refresh → dispatch release | 01,06,15,16,21 | Real login, recorded configuration/three axles, mandatory attestations, PASS, restored attempt and server-recorded release |
| Quarantine → denied bypass → corrected inspection → release | 16,18,21 | Failed synthetic mass control, direct release denied, forged status PATCH denied, fresh passing attempt; both attempts retained |
| Exception request → self-approval denial → separate approval → release | 19,20,21 | Actual supervisor identities, separate request/reason and approval, original QUARANTINE retained, release bound to approval |
| Missing cross-border configuration → review-required → denied release | 16,28 | Missing jurisdiction bundle cannot pass, no permitted-exception affordance, exit denied |

The harness checks the final database: three release records exist for their own arrivals, the missing-configuration arrival has none, remediation has two attempts, and the exception's original decision remains QUARANTINE.

## Findings and corrections

1. **Release role mismatch — fixed locally.** QueueDashboard hid Release from DISPATCH_SUPERVISOR and displayed eligibility for ADMIN, while the server permits dispatch/operations/facility and denies admin. Button visibility now matches the existing server policy. The new passing-inspection browser journey tests dispatcher release; server permissions were not widened.
2. **Equal-timestamp offline replay inversion — fixed locally.** IndexedDB's timestamp index could order same-millisecond commands by random ID, allowing dependent compliance work to replay before arrival creation. Dexie v3 adds a transaction-assigned persistent sequence as a tie-breaker while retaining original capture time. Regression forces reverse-sorted IDs at the same timestamp. Migration test preserves owner/site/API, blocked state, failure reason, retries and capture time. Historical true order for pre-existing ties cannot be recovered; migration preserves prior replay order.
3. **Production regulatory backend absent — unresolved deployment blocker.** Protected registry returns404. The earlier Render source/database findings and pending data-preservation decision still apply; testing does not authorize erasing existing records.
4. **Resolved-load critical alerts remain visible — product gap to decide.** A reinspection/release can leave the original critical alert active. The release itself succeeded; treating every global alert as a release error was an incorrect initial test assertion. Alert resolution/acknowledgement policy remains part of BAK-24 rather than being silently changed by this testing task.
5. **Context-authoring/provenance/passport journey incomplete — known gaps.** Setup is possible via domain/API primitives, but authoring screens, complete source drill-down, protected file inspection and passports cannot yet be tested as complete browser journeys.

Harness repairs: corrected the initial sign-in selector; replaced shared in-memory SQLite with a disposable file database after a threaded token-authentication error; separated Playwright output directories to prevent concurrent suites deleting each other's traces; asserted the actual released row rather than an exact text node/global absence of alerts. These harness failures are not misreported as production application bugs.

## Coverage ledger

“Subset” means relevant checks passed or are part of the new real-API journey; remaining acceptance criteria still apply. “Gap” means a required user-facing capability is missing. “Not exercised” means this run provides no acceptance claim.

| Story | Evidence from this run | Remaining acceptance gap |
| --- | --- | --- |
| 01 Shift sign-in | Subset: real email login, identity changes/refresh; practice roles | PIN browser checks and complete shared-device acceptance |
| 02 Provisioning | Subset: backend tenant/site denial | Invite/role-grant UI and complete escalation matrix |
| 03 Site selection | Backend scoping subset | Authorized multi-site selector journey absent |
| 04 Trustworthy mode | Production/practice display subset | Separate connectivity/configuration/verification/freshness semantics |
| 05 Arrival | Practice registration plus yard API subset | Real offline browser outage→replay journey |
| 06 Context | Real journey consumes configured context; API checks | Context-authoring UI; no full UI acceptance |
| 07 Docks | Practice and transactional API subset | PostgreSQL races and approved allocation policy |
| 08 Shift queue/dwell | Practice/live board subset; API reports | Freshness UI and approved dwell thresholds |
| 09 Source provenance | Registry/review backend subset | Source authoring/detail screens and actual source review |
| 10 Evidenced ratings | Backend guards and real inspection context | Rating authoring/reviewer UI; real manufacturer evidence |
| 11 Evidence review | Backend expiry/review/ownership subset | Complete collection/review UI and actual documents |
| 12 Secure files | Gap | File storage/authentication/access workflow absent |
| 13 Ruleset publication | Independent publication backend subset | Authoring/publication UI and statutory configuration |
| 14 Version transition | Future-version/history backend subset | In-window supersession and historical reproduction UI |
| 15 Measurement | Real browser manual mass entry subset | Physical device/calibration field evidence |
| 16 Evaluation | Real API/browser and backend subset | Production deployment and actual configured operations |
| 17 Failure trace | Browser control/source summary subset | Full rule→source navigation absent |
| 18 Remediation | Reinspection/history subset | Structured corrective-action record/UI absent |
| 19 Exception request | Real API/browser and server subset | Operational SOP acceptance |
| 20 Independent approval | Real actor separation/server subset | Rejection-path full UI acceptance and operational SOP |
| 21 Release | Real browser/API and server bypass/staleness subset | PostgreSQL concurrency and coordinated production deployment |
| 22 Passport | Gap | Generator/view/export absent |
| 23 Audit reconstruction | Current backend chain tests subset | Full metadata-envelope verification and linked export/verify UI |
| 24 Incident response | Practice acknowledgement and retained critical alert observed | Versioned resolution policy and full incident journey |
| 25 Delivery/escalation | Not exercised | Provider delivery, credentials, runner and timer acceptance |
| 26 Reports | Practice CSV plus API report subset | Full metric reconciliation and utilization history |
| 27 Executive overview | Executive practice navigation subset | Integrated record-derived exception overview |
| 28 Cross-border | Missing-configuration negative journey | Successful configured corridor and deadline journey |
| 29 Abnormal loads | Gap | Dimension/permit operators and full permit workflow |
| 30 Change Watch | Gap | Discovery/review/impact UI absent |
| 31 Read-only assistant | Gap | Retrieval assistant absent |
| 32 Offline reconciliation | Ownership/failure/order/migration unit subset | Review/export/retry UI and real outage browser journey |
| 33 Offline rules | Gap | Versioned offline evaluator/bundle absent |
| 34 Enterprise integration | Internal API subset | External service identity/adapter/contract UAT not exercised |
| 35 Canonical training | Existing practice regression subset | Interconnected versioned golden-path fixture/passport |
| 36 Device usability | Mobile sign-in smoke plus desktop flows | Low-end tablet/accessibility/two-hour outage field acceptance |
| 37 Safe deployment | Deployed protected API check fails | Persistent DB/backup, source alignment, migrations, release checks |
| 38 Export/retention | Existing report export subset | Complete tenant export/approved retention/deletion workflow |
| TRK-01–06 | Not exercised | Deferred fleet/commerce stories have no acceptance claim from this run |

## Re-run commands

From `backend/` in PowerShell:

```powershell
$env:RUN_STORY_BROWSER='1'
.\.venv\Scripts\python.exe -m pytest tests/test_story_browser.py -q
Remove-Item Env:RUN_STORY_BROWSER
.\.venv\Scripts\python.exe -m pytest tests/test_regulatory.py tests/test_gate_integrity.py tests/test_cross_tenant.py tests/test_audit_chain.py tests/test_yard_api.py tests/test_story_api.py -q
```

From `web/`:

```powershell
npm run test -- --maxWorkers=2
npm run test:e2e -- --project=chromium --retries=0
$env:PW_PROD='1'
$env:PW_PROD_URL='https://trucki-qgld1o9z7-brandontinozs-projects.vercel.app'
$env:PW_PROD_API_URL='https://spotteraiassessment-khaj.onrender.com'
npm run test:e2e -- --project=production --retries=0
Remove-Item Env:PW_PROD,Env:PW_PROD_URL,Env:PW_PROD_API_URL
```

Browser launch needs the environment's process permission; use the approved test command escalation where required. The story config rejects non-local API hosts and requires the pytest fixture manifest. Ordinary pytest runs skip the browser wrapper unless explicitly enabled. The GitHub e2e job now includes the opt-in wrapper locally; that workflow change is not active until pushed.

Failure traces use separate `web/test-results/stories/`, `production/`, `practice/` directories. The production failure captured before that directory change is under `web/test-results/prod-smoke-versioned-API-i-a9aa9-d-and-protects-its-registry-production/`. No source, penalty or physical measurement is asserted to be verified law by these tests. Local fixes/tests in this turn have not been deployed.
