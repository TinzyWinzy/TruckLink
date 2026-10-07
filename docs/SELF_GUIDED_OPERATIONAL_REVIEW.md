# Self-guided operational review

7 October 2026. BAK remains the first configured tenant. Tariro represents Trinitas, not BAK. No Trinitas tenant, provider credentials, verified-law claim or monetary penalty was introduced.

## Reviewer entry points

- Samuel: sign in with an individually authorised BAK account, select the assigned site, then open `/guide`. Administration now exposes staff provisioning through the existing restricted backend endpoint. Do not share an Admin account for independent approvals.
- Tariro/external reviewer: `/?demo=1&role=admin&walkthrough=1` opens the platform practice guide. It uses synthetic local data and makes no tenant API calls. Practice role selection does not grant tenant access. The guide describes live-only commands honestly rather than presenting them as a connected ERP demonstration.
- The guide covers all six staff types, responsible owners, prerequisites, expected outcomes, role-permitted links and learning progress scoped by account/site/device. Driver and receiver portals are not implemented.
- Live readiness is GET `/api/walkthrough/?facility=...`, constrained to the authenticated tenant/site. Inventory counts do not certify reviewed evidence or release eligibility. Missing context is resolved by actual record owners, never fabricated operational data.

## Exposed operational commands

Routes retains the linked journey and exposes:

1. Versioned delivery plans before release, selecting ordered delivery destinations from the retained itinerary and assigning unique consignment references, positive quantities and units. Intermediate acceptance does not complete a trip. Existing unplanned journeys preserve single-destination semantics.
2. Full rejected-stop return authorisation by Operations/Facility Manager, with an assigned same-tenant receiving site and retained route reference/fingerprint/jurisdictions. Return statutory clearance is explicitly not evaluated. Remaining stops must resolve before return movement.
3. Return transit, arrival against a newly registered matching receiving-yard visit, and named receiver plus receipt reference/fingerprint. Completion with returns is distinct from accepted delivery. Partial rejection, splits, new itinerary destinations and ERP credit notes remain outside this increment.
4. Withdrawal of unused versioned release authority on `SEPARATE_V1` visits before physical exit. The visit is held and needs a fresh inspection before reauthorisation. Every release and withdrawal remains retained; dock vacancy is not reversed. There is no pretend reversal of physical departure.

The information hub now explains evidence, ownership and blocked steps. Its old statutory/financial marketing claims have been removed. ERP/tracker integration status remains unconfigured; manual references and staff attestations are labelled accordingly. Marketplace discovery found no suitable incumbent ERP/tracker product. Provider names, documentation, sandbox access, identifiers and event ownership remain customer discovery prerequisites.

## Verification

- Backend regression suite: 700 passed, one opt-in browser test skipped, eight live checks deselected. Subsequent API exposure check: all ten new execution tests passed; final timeline changes also passed 25 journey regression checks.
- Frontend unit suite: 82 passed. Build and lint passed; existing Fast Refresh/bundle warnings remain.
- Five local Chromium contract flows passed across desktop/mobile: inspection setup, distinct milestones/rejected-delivery reattempt, site readiness, isolated shareable practice and authorised return receiving/receipt. Intercepted disposable responses test interface contracts; backend tests independently verify state transitions and access restrictions.
- Django system check and migration drift check passed. Three migrations are included: retained delivery/return models, release history/withdrawals, and returned trip status.
- Production verification is read-only for operational records. Authentication/session and selected-role audit effects are permitted. Release IDs and production results will be recorded after deployment.

## Production release and results

- Application commit: `27ab48b12e47d4f71a15deaf50ccb94c1eac21e0`.
- Frontend: https://trucki-two.vercel.app/; immutable https://trucki-bwpykzgjv-brandontinozs-projects.vercel.app/, deployment `dpl_6pX5MgTfjw74o1sM93xMbqzBVHTF`. CLI inspection confirmed Ready and the production alias.
- Backend: https://spotteraiassessment-khaj.onrender.com/, deployment `dep-db32vp8473hc7388bqt0` live at the application commit. Startup ran the three included migrations before Gunicorn served the new application.
- All 13 production browser/API checks passed serially in 1.3 minutes: assigned-site walkthrough/readiness, disabled incomplete staff-creation form, inspection setup, migrated journey/yard reads, renewal/logout, Admin role continuity, real versus synthetic routes/map, mobile login, shareable external practice guide and practice refresh. Traces were disabled for authenticated production checks.
- No production fleet, evidence, journey, account or release/return records were created. Session and working-role audit effects occurred. Return execution was verified against backend fixtures and intercepted local browser contracts, not a fabricated production customer journey.
- Entry 1 remains blocked by `VEHICLE`, `TRIP`, `RATINGS`, `LOAD`, with zero eligible trips, usable configurations or loads. Reviewers need actual records and independent evidence reviews to perform the live flow.
- Final focused frontend verification after readiness cleanup: nine checks passed. Final new backend API/execution suite: ten checks passed.
