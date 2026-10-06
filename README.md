# Trucki transport operations platform

## Tenant platform direction, 6 October 2026

Trucki owns the reusable transport entities, regulatory evaluator and operational
workflows. BAK Logistics is the first configured tenant and reference implementation.
Tenant branding, policies, sites, role configuration and credential bindings are
separate from platform behavior. The refactor preserves existing entity IDs,
credentials, evidence, audit history and validated prototype flows.

Start with the [tenant platform architecture](docs/TENANT_PLATFORM_ARCHITECTURE.md)
and [BAK tenant reference](tenants/bak/README.md). The existing regulatory source
verification boundaries remain in place; this refactor does not verify new law.

The [architecture amendment](docs/TRANSPORT_REGOPS_ARCHITECTURE_AMENDMENT.md)
sets the next implementation boundary for configurable modules, full workflow
versions and platform-owned regulatory knowledge. It distinguishes that target
from the deployed foundation. A second tenant requires operational discovery.
The [release implementation](docs/TENANT_RELEASE_IMPLEMENTATION.md) records the
implemented schemas, APIs, activation and migration behavior for this amendment.

Start with the [current documentation index](docs/README.md),
[repository audit](docs/BAK_EXISTING_SYSTEM_AUDIT.md),
[upgrade plan](docs/BAK_REGOPS_UPGRADE_PLAN.md), and
[directory/product strategy](docs/BAK_DIRECTORY_AND_PRODUCT_STRATEGY.md).
The [implementation progress](docs/BAK_IMPLEMENTATION_PROGRESS.md) records the
first stabilization changes and migration/activation constraints.
The earlier BAK strategy and Trucki specifications are preserved as prior roadmap/architecture
lineage. The existing web/backend directories remain the active runtime.

Multi-tenant yard OS: weighbridge compliance, dock scheduling, dwell/turnaround
analytics. Mobile-first PWA (React + Vite) over a Django/DRF API (Postgres).
Product specs: [`docs/PRD_v2_Trucki.md`](docs/PRD_v2_Trucki.md) ·
[`docs/SAD_v2_Trucki.md`](docs/SAD_v2_Trucki.md).

## Layout

- `backend/` — Django 6 + DRF API (auth, tenancy, yard, compliance engine, audit chain)
- `backend/tenancy/` — versioned tenant configuration and integration bindings
- `tenants/bak/` — BAK Logistics reference configuration
- `web/` — React PWA frontend
- `docs/` — PRD/SAD; `docs/archive/` — superseded BAK-era documents
- `render.yaml` — production blueprint (API + Postgres)
- `.github/workflows/ci.yml` — tests: backend pytest · frontend lint/typecheck/vitest/build · Playwright e2e

## Local development

```bash
# API (Python 3.14, sqlite fallback when DATABASE_URL is unset)
cd backend && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
set DJANGO_SECRET_KEY=dev-secret && set AUDIT_SALT=dev-salt
.venv\Scripts\python manage.py migrate && .venv\Scripts\python manage.py runserver

# PWA (practice mode without VITE_API_URL; live with it set)
cd web && npm ci && npm run dev
```

Tests: `pytest -m "not live"` (backend) · `npm run test` + `npm run build` (frontend) ·
`npx playwright test` (demo e2e) · `--config playwright.live.config.ts` (live e2e, Django up).
