# Production interface validation — 2026-10-05

## Release state

The user authorized deploying current changes and then testing. The frontend was built with the existing Vercel production environment using a repository-root upload (project root directory: `web`). No legal instrument or monetary penalty was activated or asserted to be verified law.

- New frontend: `https://trucki-qgld1o9z7-brandontinozs-projects.vercel.app`
- Deployment: `dpl_DLLF983gYgMjdV2ub6JSNyqDjHrP`, READY, production target.
- Command: `npx --yes vercel deploy --prod --skip-domain --yes` from the repository root.
- Vercel nevertheless assigned the project alias `https://trucki-brandontinozs-projects.vercel.app` to this release. The main domain `https://trucki-two.vercel.app` still served the prior asset `index-BCUvbw6-.js`; the new release serves `index-COi1d2H0.js`.
- Actual API discovered from the public deployed bundle: `https://spotteraiassessment-khaj.onrender.com`, differing from the repository blueprint.
- That API returned 200 from `/api/health/` and 404 from `/api/regulatory/sources/`. The backend upgrade has not been deployed.
- Render connector requires explicit workspace selection. `My Workspace` was offered to the user; selection is pending. No Render service was inspected or changed.
- Main-domain promotion, backend migrations, Git commit/push, and activation of the new GitHub production-check workflow remain pending.

## Checks and repair

The prior main-domain release passed six interface checks and failed mobile overflow: a login wrapper extended from -16 to 406 pixels in a 390-pixel viewport. Its negative margins assumed a parent layout which the login route does not use. Those margins were removed.

The new release passed **7 production Chromium interface checks**, with retries disabled (13.0 seconds): live gate, explicit practice roles, mobile fit and email-method switching without browser exceptions, dispatch deep link, executive role switching, Hub/Guide navigation, and practice-session refresh. The optional versioned API check was skipped because its backend has not been deployed. These were unauthenticated/practice checks; they did not exercise real inspections, approvals, or releases. A browser routing guard aborts API mutations before sending them.

The latest local frontend checks also passed: **60 unit tests across 12 files**, production build, and lint (one existing Fast Refresh warning). Existing build warnings concern bundle size and a deprecated PWA bundling option.

The production test URL is configurable with `PW_PROD_URL`. Once Django is deployed, supply `PW_PROD_API_URL` to require health and protected regulatory registry routes. Protected registry responses must be 401 or 403; a 404 fails the release check.

`.github/workflows/production-interface.yml` prepares checks after successful Production deployment events and via manual dispatch, with failure traces retained for 14 days. It is not active until pushed. It currently targets the confirmed main domain and API host.

Vercel CLI was used through `npx`; a global installation (`npm i -g vercel`) is recommended for subsequent deployment, environment and log operations.

## Approved rollout follow-up

The user subsequently approved using My Workspace. Render inspection confirmed service `srv-d9kj83tg1s2s73f2pc6g` builds `TinzyWinzy/SpotterAiAssessment` main, with `backend/` as root, automatic deploys, and `python start.py` as startup command. This checkout's source repository is `TinzyWinzy/TruckLink`. The connector cannot edit a service's source repository, and the browser dashboard requires login; a dashboard sign-in handoff is pending before that source can be aligned. No changes have been pushed to the older repository.

Before release, `start.py` was hardened to abort on migration failures and require `ALLOW_DEMO_BOOTSTRAP=true` for demo-user seeding. Three focused startup regressions pass. Database persistence must be checked on the actual service before a redeploy; the source supports SQLite fallback and the free service has no disk indicated in service metadata.

Release `0227260a7b0380d0ebe71e4c400dd1d7f31a1511` is now committed and pushed to TruckLink main; the CI run is `https://github.com/TinzyWinzy/TruckLink/actions/runs/37371587074` (queued when checked). The production interface workflow is now present in GitHub.

The Render dashboard subsequently became accessible. Its environment lists only `ALLOWED_HOSTS`, `CORS_ALLOW_ALL_ORIGINS`, and `DJANGO_SECRET_KEY`, with no secret files or linked environment groups. There is no `DATABASE_URL` and the free service has no mounted disk; Django therefore uses ephemeral SQLite. Changing its source or redeploying can erase existing records. The user has been asked to choose preservation/backup/persistent storage or explicitly authorize discarding existing pilot data. Until that decision, no source change, backend redeploy, or main-domain promotion is performed.
## Design release — 2026-10-06

The user authorized deployment of the updated interface. Vercel production deployment `dpl_6JJ8LfiLEMvPtGP34Y4WCi73Epz7` is READY at https://trucki-ohtvsbpnu-brandontinozs-projects.vercel.app, with alias https://trucki-brandontinozs-projects.vercel.app. It includes the NetOne/VehicleImport-inspired BAK workbench and preceding local frontend fixes. Deployment used the existing production environment through a repository-root upload; no backend redeployment or account/password mutation was performed. The backend persistence decision remains pending. No live credentials are verified; the explicit practice link uses training data and requires no password.
Read-only production Chromium smoke checks for this design release: 7 passed (12.6s), with the versioned backend check explicitly skipped because that backend was not redeployed. Gate rendering, mobile sign-in layout, practice entry, dispatch deep link, role switching, Hub/Guide and refresh were exercised. These checks do not verify live operational transactions.
Credential verification: the existing backend accepted its source-documented seeded admin login. Its response has no `role` and no organisation, so the frontend rejects it as an unassigned account. Backend authentication success is not working BAK operational access. No role mapping, permission bypass, account reset or backend deployment was performed. The user's credentials request can be answered with this qualification and the verified password-free practice link.
## Fresh backend rollout — 2026-10-06

The user explicitly authorized discarding the previous pilot data and deploying a fresh backend. Existing service `srv-d9kj83tg1s2s73f2pc6g` was switched from SpotterAiAssessment to TruckLink main at commit `5e048ea0993ea62ef3e754f966c1dd1565a916dc`. The old SQLite data is not migrated into the new database.

Created `bak-regops-db`, PostgreSQL 17, Render free plan, Oregon, ID `dpg-db22qa97lnhs73dddri0-a`. External database access is blocked. The internal connection is configured as `DATABASE_URL` on the backend; no connection credentials are stored in this report. This database survives web-service redeploys but expires at 2026-11-04 23:05 UTC (5 November in Africa/Johannesburg) unless upgraded. No paid plan was purchased.

Backend configuration explicitly disables DEBUG, demo bootstrap and unrestricted CORS; trusted BAK frontend origins are allowed. Normal startup performs migrations and stops on failure.

An attempted frontend facility ID configuration was rejected by automatic approval review because the ID was unverified. No frontend environment change was made by that attempt; provisioning and verification must return the actual facility ID before configuration.
Fresh Postgres backend deploy `dep-db22rbnlot8c73dkehh0` reached LIVE at 2026-10-05 23:08:48 UTC. Provisioning administrator `admin@bak.local` and dispatch supervisor `TRK-BAK-DISPATCH` for a new BAK Operations / BAK Main Yard was rejected by automatic approval review because the exact identities, roles and access scope were not explicitly approved. No accounts were created by that attempt. A specific approval request is pending. Frontend facility configuration therefore remains unchanged until the actual facility is provisioned and verified.
Post-deployment verification: the real production versioned-API smoke check passed, including health and protected source/ruleset/configuration registries. Render logs confirm regulatory migrations 0001 and 0002 applied successfully to the fresh Postgres-backed service. Account setup and authenticated operational browser checks remain pending exact account-scope approval.
## Administrator role switching — 2026-10-06

The user requested ADMIN PIN access and role switching limited to administrators. Provisioned BAK Operations / BAK Main Yard (facility ID 1) and verified the ADMIN PIN account using `/auth/pin/` and `/auth/me/`. The frontend production facility is now set to this server-verified facility. Credentials are provided directly to the user and are not recorded here.

Role switching is server-authorized through `/api/auth/switch-role/`. Only a profile with assigned base role ADMIN can select one of the six working roles. Token authentication applies the selected working role to existing permission helpers. Identity, organisation and facility membership remain unchanged, preserving separate-person approval checks. Each change appends ADMIN_ROLE_SWITCH audit entries for the administrator's assigned yards within their organisation. Unknown roles, ordinary users and non-token sessions are rejected. New sign-in resets the working role to the assigned role; logout removes the token and its selection. The existing API token is shared across tabs for the same account, so its selected working role is shared too.

The frontend shows the role picker only for accounts whose assigned base role is ADMIN, retains it when acting in another role, restores it on refresh, and reports server errors without switching locally. Switching requires connectivity. Practice ADMIN accounts can also preview roles; ordinary practice accounts no longer expose the header role picker. No law or monetary penalty is newly verified or activated.
ADMIN role-switch release: backend commit `65d20cfc4d7ace57cfde26f9f46668234ed5697e` deployed successfully (`dep-db29oiuq1p3s73ee5ut0`). Frontend deployment `dpl_8xNT1vwjvVqFMDpJf5UKhGNFtrtX` is READY and promoted to https://trucki-two.vercel.app, with immutable URL https://trucki-75lhbqvvs-brandontinozs-projects.vercel.app. The immutable origin was added to the backend allowlist.

Validation: 69 focused backend auth/gate/tenant checks passed, with the five role-switch checks repeated successfully after the final organisation-scope adjustment. Frontend build passed; 62 unit tests and 17 practice browser tests passed. Nine production browser checks passed (24.2s), including real ADMIN PIN sign-in, server-verified ADMIN base role, switch to Dispatch, same user ID, successful queue access in its assigned facility, refresh preserving the selected role, return to ADMIN and sign-out. No yard arrival, inspection, approval or release records were created during this production check; role-switch audit entries were intentionally appended. Browser traces were disabled for credential entry. Screenshot: docs/design/bak-live-admin.png.


## Tenant foundation and synthetic modelling, 6 October 2026

Trucki now displays the authenticated organisation and authorized yard selection. Build-wide facility scope is removed; server membership is authoritative and private routes remount on yard changes. BAK Operations remains one tenant. Synthetic modelling runs seven evaluator cases and a seeded capacity simulation without operational database writes. Export includes assumptions, input/context/ruleset snapshots and result digest. Statutory sources and monetary penalties are not asserted as verified. Unsupported fines/payback figures were removed from Reports; visible long em dashes were replaced and copy edited.

Local validation: 49 auth/tenancy/role/modelling checks passed, followed by all four final modelling checks (including capacity sensitivity and dispatch-role denial). Existing 62 frontend units passed; the new workspace test passed, rejecting foreign stored/build scope and switching tenant identity. Build passed. Sixteen practice browser checks passed, with the remaining dock status copy selector corrected and its targeted rerun passing. Production verification is recorded below after deployment.

Production result: all 10 browser tests passed in 36.3 seconds against https://trucki-two.vercel.app after frontend deployment dpl_EEfMBGJ7cTXfiowdr1JXRczkhgZb and backend deploy dep-db2a567avr4c73aeg16g became live. Application source commit: 8641e53406a490b0a5b527136e3760c2bb36211f. Real admin sign-in and role restore passed; all seven evaluator cases matched; the downloaded JSON contained synthetic flags, 72 movements, context and ruleset snapshots. The visible modelling page contained no long em dashes. Mobile layout fit the 390px viewport. Default seed 42 produced 48 serviced and 24 blocked vehicles, 0.93 minute mean wait and 70.92% dock utilisation. These are model outputs, not observed operations. No yard arrival, inspection, approval or release records were created. Screenshots: docs/design/tenant-model-desktop.png and docs/design/tenant-model-mobile.png.


## Polling throttle correction, 6 October 2026

The global authenticated 120/hour DRF throttle was incompatible with live dashboard polling. Operational authenticated requests now use a separate operational_user bucket at 600/minute. Anonymous operational requests use 60/minute. Credential endpoints use independent 20/hour identity and 120/hour IP budgets, shared across credential endpoints for the IP budget; staff ID normalization prevents alternate formatting from bypassing identity limits. Existing specialized trip/public booking limits remain in place. The new operational bucket does not inherit the exhausted hourly user bucket.

Backend commit 478cc1ef65f84c115fca131b250b5c96cff341c7 deployed live as dep-db2a87nlk1mc738mdfn0. All 22 auth/tenancy checks and three throttle regressions passed. Regressions verify 125 consecutive identity reads despite exhausted old quota, shared credential IP limits with Retry-After, and PIN identity limits across changing IPs. All 10 production browser checks passed in 36.7s after deployment, including real admin Reports landing, role switching, refresh and synthetic model export.


## NetOne-inspired Reports review, 6 October 2026

Reviewed the actual NetOne portfolio implementation and applied its metric strip, distribution/review pairing, source coverage and evidence-navigation patterns to Trucki Reports. Source and adaptation notes are in NETONE_DESIGN_REFERENCE.md. Existing tenant/yard context and role gates remain authoritative. Build and lint passed; all 18 practice journeys passed across the suite and targeted selector corrections. Desktop/mobile screenshots were inspected at 1440px and 390px.

Frontend application commit 73cbb04 deployed READY as dpl_33xa9FckrERM2pEcuRnoKSmHAYWb and promoted to https://trucki-two.vercel.app. All 10 production browser tests passed in 41.6s, including real Reports data reads, review/data availability panels, admin role switching and model export. The final admin screenshot waits for a successful operational read after returning from Dispatch. No operational movement, inspection, approval or release records were created by these interface checks.

## SpotterAI route and map adaptation, 6 October 2026

Application commit `ac4e2f457a172e32a65daeed8035eecfad9b27a2` deployed to Render as `dep-db2b6svf3r2c73fe8vn0` (LIVE, finished 08:39:12 UTC). Frontend `dpl_93f51Sr83kavuvEEPnQwZHjfTXuV` is READY and promoted to https://trucki-two.vercel.app; immutable deployment: https://trucki-3l3u493mg-brandontinozs-projects.vercel.app. The new yard-scoped API reads succeeded, confirming the new Trip fields are available in production.

The first 11 production browser checks passed in 52.9 seconds, including authenticated yard routes, real generic-driving route preview, synthetic-map isolation, stale-position evidence and mobile layout at 390px. The real preview returned two ordered stops, positive road distance, heavy-vehicle suitability UNVERIFIED and regulatory clearance NOT_EVALUATED. Editing origin invalidated the preview and disabled saving. No trip, arrival, inspection, approval or release records were created. Existing admin working-role checks append their expected audit events.

Visual review caught OpenStreetMap access-blocked images despite the original loaded-image assertion. The deployed no-referrer header conflicted with the tile policy, and Playwright interception disabled caching. The fix sends only the origin on cross-origin HTTPS requests, sets the tile-specific referrer policy and leaves normal browser caching enabled in the production map test. The strengthened test checks successful tile HTTP status and confirms no draft writes.

Final frontend application commit `3673c96` deployed READY as `dpl_4gJshzXDPULSeVtkwP6uEzZi8JzE` and promoted to https://trucki-two.vercel.app (immutable URL https://trucki-d5xpj1c9b-brandontinozs-projects.vercel.app). The strengthened production route test passed in 13.0 seconds after this deployment: road routing succeeded, tiles returned successful HTTP responses, there were no tile HTTP errors or draft writes, and all stop markers remained inside the map after desktop/mobile resizing. Final screenshots were visually reviewed to confirm real geographic imagery. The backend remains the live `ac4e2f4` release; subsequent application changes affect only the frontend and verification.

Screenshots: `docs/design/trucki-routes-production-desktop.png` and `docs/design/trucki-routes-production-mobile.png`. Local verification passed the 66-test trip/tenant/regulatory regression group, nine final route tests, 63 frontend tests and 20 practice browser flows. Build, lint and Django migration consistency checks passed. Routing/service limits and API contracts are documented in `../ROUTING_AND_MAP.md`.

## Transport platform ownership refactor, 6 October 2026

Trucki owns the transport domain, reusable workflows and regulatory evaluator. BAK Logistics is the first configured reference tenant. Versioned tenant configuration holds branding, enabled roles and labels, permission restrictions, mandatory operational checks, freshness and escalation settings, and operator-controlled integration bindings. A separately published platform regulatory catalogue supports explicit tenant adoption/revocation without sharing vehicle, driver, trip or inspection evidence. Existing BAK entity IDs, independent approvals, audit history, offline identifiers and API contracts remain intact. Historical tenant rulesets continue to work until explicit catalogue adoption. No instrument or monetary penalty is asserted to be verified law.

Local verification: the full non-live backend suite passed 644 tests (one opt-in browser story skipped and eight live tests deselected). After final tenant changes, all eight tenant foundation tests and 25 regulatory regression tests passed again. Tests cover cross-tenant configuration and credential denial, permission ceilings, policy-change re-evaluation, branding-only compatibility, platform publication and tenant adoption/revocation, preservation during the BAK reference migration, booking tenant selection and tenant-scoped WhatsApp signatures/conversations. The opt-in real Django API/browser stories passed separately: clean release, remediation/reinspection, independent override approval and missing-jurisdiction hold were exercised against a disposable database with synthetic policies.

Frontend build and lint passed (one existing Fast Refresh warning). All 63 unit tests, 20 practice browser flows, the versioned-inspection interface contract and the synthetic Northstar tenant administration browser test passed. The Northstar check saved branding and a role label, reloaded the session and retained its configuration without BAK defaults. Django system/migration consistency checks and whitespace checks passed. Production verification follows deployment.
