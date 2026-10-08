# Tenant modules and scoped workspaces

Implemented locally on 8 October 2026. This change defines module selection and access control. It does not introduce subscription prices, payment collection, a billing provider or a paid contract for any existing tenant.

## Separate decisions

| Decision | Owner | Record | Effect |
| --- | --- | --- | --- |
| Requested capabilities | Tenant administrator | Immutable `TenantModuleSelection` revisions | Records interest; grants no access |
| Approved module access | Active platform superuser | Immutable `TenantEntitlementVersion` revisions | Sets the tenant's access ceiling, basis and effective dates |
| Operational configuration | Tenant administrator and independent reviewers | Existing typed artifacts, reviews, release and activation | Chooses configured modules, sites, workflows, policies and adapters |
| User access | Tenant permissions and assigned sites | Existing role/site authorization | Narrows access within the effective modules |
| Movement readiness | Operational evidence and evaluations | Existing inspection, approvals, release and exit records | Determines whether a particular movement may proceed |

Effective module access is the intersection of the current entitlement and active configuration, with dependency checks. Audit remains included. Subscription access never grants release authority or overrides a failed inspection, revoked review, missing vehicle configuration or site restriction.

Platform regulatory sources, ROUs and rule versions remain shared platform knowledge. Tenant operating policies remain classified as tenant policies. This change asserts no verified legislation or monetary penalty.

## Catalogue and dependencies

The catalogue uses existing domain identifiers, avoiding a second set of feature flags:

| Module | Required modules |
| --- | --- |
| Fleet and driver records | Audit |
| Yard and gate control | Inspection and release safeguards, audit |
| Dock operations | Yard and its safeguards, audit |
| Inspections and evidence | Yard and release safeguards, audit |
| Release approvals | Inspection and yard safeguards, audit |
| Dispatch and delivery | Fleet, audit |
| Operational intelligence | Audit |
| Synthetic modelling | Operational intelligence, audit |
| Notifications | Audit; provider configuration is separately required |
| Audit and history | Always included |

Yard, inspection and release form a safety bundle. Dependency expansion reaches a fixed point, including for this cycle. A tenant cannot remove release safeguards while continuing yard operations. Dependencies define access requirements, not proof that a module's data sources or integrations are ready.

Connected fleet tracking is explicitly unavailable as a subscription capability until adapter discovery and implementation. Existing ERP/tracker systems must not be described as integrated by selecting a checkbox.

## Tenant experience

`/onboarding` provides module choices, included dependencies and current access status. Saving creates a request revision with optimistic concurrency and an audit entry. It accepts module identifiers, expected revision and reason; no additional personal or contact details are required.

`/workspace` shows capability cards derived on the server from effective modules, the current role, tenant permissions and the assigned site. The client also applies its route gates. Admin receives dock setup; Operations receives dock operations. Inaccessible actions are omitted. Loading, failed requests and confirmed empty results are distinct.

New tenants with an explicit contract/trial entitlement land on their scoped workspace after operational activation. Unreleased tenant administrators continue to land on onboarding. Established continuity tenants keep their previous role landing screens and can open Workspace from navigation. Role/site changes remount private screens, preventing old scoped content from carrying into a new workspace.

This workspace is a capability dashboard. Existing recorded yard graphs and five-second polling remain inside Operational intelligence. It does not invent live metrics for delivery, fuel, financial performance or unconnected trackers. Data freshness and missing feeds remain the responsibility of each module's existing presentation.

## Operator workflow

There is no tenant-facing endpoint that grants entitlements. A platform operator uses the management command after the commercial arrangement or trial has been agreed outside Trucki. The operator must already be an active superuser; a tenant administrator is insufficient.

Example with placeholders, run from the backend:

```powershell
python manage.py issue_tenant_entitlement --tenant example-transport --operator existing-platform-operator --modules yard docks routing reports --expected-version 1 --basis TRIAL --effective-to 2026-12-01T00:00:00+02:00 --reason "Approved trial reference"
```

The command appends a revision and site audit entries atomically. It does not modify tenant configuration or activate a release. To change or suspend access, append another revision using the latest expected version; never edit or delete previous revisions. Effective timestamps require a timezone offset. Current access is evaluated on requests, so expiry does not depend on a scheduled task. The highest effective revision wins; expiry or suspension does not resurrect an older grant.

The tenant then selects entitled modules in its existing configuration tools, obtains the required independent workflow/policy reviews, and activates a release. Both release publication validation and activation check entitlement. Existing evidence and operational gates still apply afterwards. A session refresh/sign-in reloads effective navigation after an operator changes access; the server enforces new command restrictions immediately.

## Migration and continuity

Migration `0005` adds retained selection and entitlement tables. Migration `0006` grants a one-time `LEGACY_CONTINUITY` revision to existing tenants. Established tenants retain their access ceiling; their active module configuration still narrows actual access. An existing tenant that requires a release and has no effective activation receives audit-only access. This preserves the Trinitas onboarding lock and does not configure its operating procedures or operational modules.

The pre-existing `requires_release=False` compatibility flag remains an explicit fallback for unmigrated legacy-style tenants without an entitlement row. Public signup always creates `requires_release=True` tenants, which fail closed without a grant and activation. Future provisioning must use that onboarding path; the compatibility fallback is not a subscription enrollment mechanism.

Suspending a module blocks new operational writes through existing command enforcement and removes it from effective navigation. Existing authorized historical reads and exports retain role/tenant/site restrictions; suspension does not erase evidence or audit records. The native live dashboard additionally requires an effective reports module; its dock and alert aggregates respect module access. Do not interpret this as a blanket paywall over every historic GET endpoint.

No production grants, customer payment records, new operating sites or operational movements are created by this implementation. Deploy backend migrations before deploying the new frontend. Do not reset the database. Billing automation, invoicing, quota enforcement, self-service cancellation and an operator approval console remain future commercial work, requiring actual product and contract decisions.

## Verification

Backend tests cover dependency expansion, immutable grants and selections, request-only onboarding, role/site isolation, grant concurrency, effective dates, suspension, independent activation review and audit rollback. Interface tests cover loading/retry, request persistence without activation, permitted workspace cards, foreign-response rejection and practice-mode separation. Browser checks use synthetic API fixtures and do not establish production payment or integration behavior.

Local verification receipt, 8 October 2026:

- Backend regression, `pytest -m 'not live' -q`: 762 passed, one optional browser test skipped, eight external-service tests deselected. A further 38 focused checks passed after the final legacy-calculator routing guard and audit-payload changes, including all 11 subscription tests.
- Frontend: all 112 unit/component tests passed; production build passed. Lint has no errors and retains the existing shared-UI fast-refresh warning.
- Chromium: six synthetic onboarding/dashboard checks passed, covering desktop/mobile layout, request persistence, scoped workspace, graph polling, stale/failure states and exports.
- Django system check and migration consistency check passed. The disposable test database applied the new migrations; no production migration has been run by this change.
- The initial unrestricted test selection also attempted the old live-service suite: seven checks failed because network connections were forbidden in this environment. They remain unverified; the production endpoints, public geocoders and router were not validated by the fixture checks.

Deployment preflight, 8 October 2026:

- All 24 synthetic interface scenarios passed across the broad run and focused admin/walkthrough rerun. The two CI-yard sign-in tests were excluded because they require their separately seeded Django fixture; production sign-in is checked separately using the existing Trinitas account.
- The broad run exposed a dock setup crash on malformed data. Dock reads now validate the response and offer a recoverable error rather than crashing or claiming an empty site. Its regression test brings the frontend total to 113 passing tests.
- The tenant-release browser fixture now supplies dock data and uses the current guided module checkbox instead of attempting to fill the collapsed advanced JSON editor.
- Production build, lint (existing shared-UI warning only), Django check and migration consistency check passed.
- Deployment is authorized by the user. Backend migrations must finish before frontend promotion. Production verification performs authentication and authorized reads only, with no operational writes or customer module requests.

## Production deployment receipt, 8 October 2026

- Runtime revision: `93618a02c477e6b9b9b048783f8c2da90fbbc546` on TruckLink main.
- Render backend: `dep-db3k9s3l550s73ajtp10`, LIVE at 07:24:29 UTC. Startup applied the new tenancy migrations. Health returned HTTP 200 with `ok=true`.
- Vercel frontend: `dpl_DZwQmX4uszBLZfy3W8nrUsiXpwd5`, READY. Vite build took 15 seconds. Staged immutable URL: https://trucki-ooz94u2ae-brandontinozs-projects.vercel.app/ . Promoted to https://trucki-two.vercel.app/ ; inspection confirmed the public URL resolves to this deployment.
- Staged HTML/asset checks passed. Browser sign-in on the temporary hostname was rejected by the backend's existing CORS policy. The public-origin preflight passed. No CORS permissions were widened; authenticated tenant API checks passed before promotion, and the full browser verification passed on the public domain afterwards.
- Real Trinitas administrator verification passed: PIN sign-in, module catalogue, included audit, v1 audit-only continuity entitlement, no active operational release, no checkout, scoped audit-only workspace, foreign workspace/audit denial, unavailable reports denial, session restoration after reload, mobile layout and sign-out.
- Browser verification observed zero page errors and zero HTTP 5xx responses. Render error-severity log scans from deployment start through 07:29:52 UTC returned no entries. This is a bounded deployment check, not continuous monitoring; drains were not audited or changed.
- No module request, contract/trial grant, release activation, dock, vehicle, trip or other operational record was created during production verification. Authentication sessions and their normal audit records were the only writes.
- Direct database queries through the hosted Render connector were unavailable under the database's existing external-connection restrictions. No networking permissions were changed. The deployed migration's Trinitas continuity result was verified through authenticated APIs; established-tenant continuity also passed disposable migration tests.

This receipt is saved locally after deployment. A documentation-only push is unnecessary and would trigger another backend deployment.
