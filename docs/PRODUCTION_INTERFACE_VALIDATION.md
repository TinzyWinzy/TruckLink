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
