# Consignments and live dashboard production release

Deployed on 7 October 2026 with user authorization. Application source: `cad9ebe70a9418501ad08085f95f1aa9de8ed436` on `TinzyWinzy/TruckLink` main.

## Production targets

- Public application: https://trucki-two.vercel.app/reports
- Consignments: https://trucki-two.vercel.app/consignments
- Backend: https://spotteraiassessment-khaj.onrender.com
- Render service: `srv-d9kj83tg1s2s73f2pc6g`, existing My Workspace, backend root, PostgreSQL-backed configuration retained.
- Render deployment: `dep-db3ag0g473hc738kfab0`, LIVE at 20:15:07 UTC. Startup logs record `journeys.0005_consignment_consignmentallocation_and_more`; the migration creates the two consignment tables and their constraints. Startup aborts on migration failure and reached Gunicorn successfully.
- Vercel production deployment: `dpl_2gnNvDaWgnXs71Q3piFWS9W1Dm2A`, READY, then promoted after staged checks.
- Immutable build: https://trucki-jwgexttl8-brandontinozs-projects.vercel.app. Production-domain inspection confirms `trucki-two.vercel.app` resolves to this deployment.

Use the public application domain for authenticated operations. The backend CORS allowlist permits that domain. The immutable build origin is not allowlisted for browser authentication; no allowlist or account changes were made for this release.

## Verification

The production build passed. Prior implementation checks covered 105 frontend unit cases, 43 dashboard/reports/admin/operations backend cases, seven dashboard/hierarchy browser cases and two practice browser cases. The consignment implementation's separate backend and interface checks are documented in [CONSIGNMENT_WORKSPACE.md](CONSIGNMENT_WORKSPACE.md).

Read-only deployment checks ran against both the staged production build and the promoted public domain:

- Staged: **10 passed, 1 skipped** in 28.3 seconds.
- Public production: **10 passed, 1 skipped** in 23.2 seconds.
- Backend health and protected regulatory registries passed.
- New dashboard and consignment endpoints return authentication-required responses rather than missing routes.
- Desktop sign-in controls and mobile sign-in layout passed. These checks verify rendering, not a successful live sign-in.
- Explicit synthetic practice graphs, chart-window switching, mobile width, practice dispatch navigation, role switching, Hub/Guide and session refresh passed.
- CORS preflight permits the public production origin.

Command, from `web`, with `PW_PROD=1`, `PW_PROD_URL` and `PW_PROD_API_URL` set to the target URLs:

```powershell
npx playwright test e2e/prod-smoke.spec.ts e2e/prod-dashboard.spec.ts --project=production --workers=1
```

The signed-in dashboard polling/consignment-register check was **skipped** because the current administrator PIN was unavailable in this deployment session. It remains pending and is guarded by `BAK_ADMIN_PIN` in the test. No credentials are stored in this report or the repository. The suite explicitly blocks operational API writes; no arrivals, allocations, approvals, releases, exits or deliveries were created during these checks.

## Boundaries

Live charts use recorded tenant/site yard events with five-second polling. Customer data availability, authenticated aggregation, live exports, full dispatch transactions and production load behavior have not been established by the unauthenticated deployment checks. Synthetic practice figures are not measured customer performance. ERP/tracker adapters remain unconfigured. No new instrument or monetary penalty is asserted as verified law.
