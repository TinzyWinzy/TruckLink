# Tenant dispatch workspace update

7 October 2026. Trucki remains a reusable tenant platform. BAK is its first configured tenant; no Trinitas tenant has been created.

## Reviewer entry points

- `/dispatch`: select a recorded visit; use the next required stage or inspect another stage. Fleet registration, route planning and trip linking, evidence review, load/context, inspection, independent approval, release, dock vacancy, physical gate exit and existing delivery/returns remain separate authoritative commands in one workspace.
- `/approvals`: Compliance opens here after sign-in. Tenant evidence/configuration reviews and site operational exceptions use separate permissions. Inspect original document references before deciding; a digest is not authenticity verification. Expired records require new revisions. Compliance reads inspections without measurement, setup, exception-approval or release controls.
- `/admin`: configure confirmed site docks and individually authorised staff. Modules, site timezone and workflow timing have guided revision fields. Other supported schemas and raw JSON remain in an advanced editor. Safety-related configuration publication and independent review requirements still apply.
- `/audit`: search retained references, actor, reason or action; choose site-local date bounds, paginate and download the full filtered CSV. Display timestamps carry the site timezone. Unknown historical references, reasons and states stay unknown. New context, inspection, exception, release, dock and journey events retain applicable business references; existing records are not rewritten.

## Accountability and permissions

Operations, Facility Manager and Admin can record a named owner from active, eligible staff assigned to the same tenant/site for the current handoff. Ownership is retained by stage in append-only `MovementOwnership` records and audit events. Stale stage/assignment updates are rejected. Unassigned or no-longer-eligible owners are explicit. An assignment grants no permissions and cannot authorise self-approval. Actual commands still check current role, tenant configuration and evidence.

All six roles receive their own worklist emphasis. Read-only roles get appropriate route-planning copy. Yard switching resets the active forms and reads. Alerts and docks distinguish loading, failure/retry and confirmed empty. Unconfigured external analytics occupies a compact notice with an Admin setup link. Branding and site labels come from tenant configuration; no dimensions or names are fabricated.

## Practice case and readiness boundary

The backend test case uses separate synthetic Admin author, Compliance reviewer, Dispatch inspector and two Operations accounts. It creates a synthetic dock, assigns the observed visit, evaluates an invented internal policy, rejects self-approval, records independent approval, authorises release, records dock vacancy and physical exit, and retains the original quarantined inspection. Browser contracts exercise setup to gate exit and offline arrival recovery using intercepted synthetic responses. These are software checks, not measured customer performance, legal validation or a customer demonstration.

The live yard still needs confirmed fleet/driver/trip/load records, reviewed rating evidence, site docks and individual author/reviewer accounts. A separate persistent training workspace has not been provisioned pending the user's choice of where the practice case should run. No production customer records were seeded or cleared. No production release or physical movement was simulated.

ERP/tracker adapters and actual notification delivery remain unconfigured/unverified. Notification tests verify queued/logged behaviour without provider credentials; they do not establish delivery. Driver/receiver portals, individual push delivery receipts and production offline-device testing remain outside verified scope. No statutory instrument or monetary penalty is asserted as verified law.

## Verification and deployment

Results and deployment IDs are appended after the production checks. One migration adds retained stage ownership: `yard/0007_movementownership.py`. Startup must apply it before serving the new read endpoints.

### Local verification

- Full backend regression before final audit/ownership enrichment: 706 passed, one opt-in browser test skipped, eight live checks deselected.
- After audit enrichment: 116 focused backend checks passed, covering regulatory, inspection, yard, journeys and audit. Named ownership subsequently exercised in the operations workspace suite.
- Frontend: 90 unit checks passed; production build and lint passed with existing Fast Refresh/bundle warnings.
- Seven local Chromium contracts passed across desktop/mobile: guided setup to physical exit, offline arrival/reconnection/reload, existing connected journey and rejected-delivery recovery, inspection setup, return receiving/receipt, site walkthrough and API-free external practice.
- Synthetic desktop/mobile guided-dispatch screenshots are retained under `docs/design/`. All operation-changing browser responses in these tests are intercepted; backend tests independently execute the real services and permission checks.
- Django system and migration drift checks passed. Production verification is read-only for operational records; authentication/session/working-role audit effects are permitted.
