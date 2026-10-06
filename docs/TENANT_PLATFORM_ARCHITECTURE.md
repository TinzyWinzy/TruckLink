# Trucki transport operations platform

Status: implemented refactor, 6 October 2026. This direction supersedes the BAK-first application/domain ownership in the earlier directory strategy and brief. BAK Logistics is the first configured tenant and reference implementation. The application, regulatory engine and reusable transport workflows belong to Trucki.

The [architecture amendment](TRANSPORT_REGOPS_ARCHITECTURE_AMENDMENT.md) defines the fuller configuration boundary. The [release implementation](TENANT_RELEASE_IMPLEMENTATION.md) records the new platform-owned source/ROU/pack registry, module activation, reviewed workflows/policies and pinned execution histories. This document describes the original foundation; production release evidence identifies which implementation is live. No second tenant is configured before operational discovery.

## Ownership

| Platform | Tenant |
| --- | --- |
| Authentication, tenant/site isolation, stable capability groups and permission ceilings | Staff memberships, enabled role groups, role labels and permission restrictions |
| Transport entity schemas: organisations, sites, vehicles, drivers, trips, loads and positions | Entity instances, yards, site timezones and operating mode |
| Sources, rule schemas, contextual evaluator, independent reviews, approvals and operational gate mechanism | Internal policies, explicit adoption of platform regulatory bundles and workflow configuration |
| Queue, dock, equipment, inspection, release, reporting, audit and offline replay implementations | Site records, required attestations, inspection freshness limits and escalation windows |
| Routing, geocoding and notification adapters | Explicit credential bindings, contact destinations and branding |

Regulatory information becomes reusable through the append-only platform catalogue. A platform custodian must explicitly publish an independently reviewed bundle; tenant ADMIN is not platform administration. Internal tenant policies cannot be promoted into the shared regulatory catalogue. Tenants independently adopt or revoke shared versions. A shared bundle can be combined with a tenant internal-policy bundle only when their rule keys do not collide. Source review revocation and effective dates are rechecked at evaluation and release.

Existing tenant rulesets retain their original custody, IDs and snapshots. They remain usable through the legacy selection path until an explicit platform adoption is configured. No statutory content is automatically promoted, verified or activated. This is an ownership boundary and compatibility migration, not a new legal-verification claim.

## Runtime directory

- `backend/tenancy/`: tenant configuration schema, immutable revisions, integration binding resolver, API and operator manifest command.
- `backend/regulatory/`: platform evaluator and provenance domain, shared catalogue, tenant selection records, context, attempts, approvals and release evidence.
- `backend/trip/`, `core/`, `yard/`, `compliance/`, `whatsapp/`: platform transport and workflow implementations. Existing Django app labels and database tables stay stable to preserve data and API contracts.
- `tenants/bak/tenant.json`: BAK Logistics reference manifest. Branding, role labels, existing operational requirements, integration bindings and reference site declaration live here.
- `web/src/components/TenantSettings.tsx`: tenant administration through versioned configuration; secrets are not exposed.
- `web/src/tenants/bak/legacyPin.ts`: archived BAK Firebase derivation. The old import path is a compatibility export; live sign-in remains the server PIN exchange.

The checkout may still be named BAK. Its filesystem name has no tenant-selection or domain-authority meaning. Historical BAK documentation is retained as lineage, not active platform ownership.

## Configuration and compatibility

`GET/POST /api/tenant/configuration/` always resolves the authenticated organisation. POST requires effective ADMIN, a complete validated schema, expected version and reason. Concurrent stale writes return 409. Tenant permissions can narrow platform capabilities and cannot remove administrative access or bypass independent-person approval rules. A tenant administrator cannot bind another tenant's credentials: integration bindings require a platform operator. Credentials stay in operator-managed environment variables; the configuration contains only provider enablement and environment prefixes.

Identity responses include the selected tenant configuration. Branding and role labels update from that response; inspection screens also read current workflow requirements from their context API. New tenants use neutral platform defaults and no notification credentials. Existing BAK credentials and sites keep their IDs, role codes and authentication behavior. The migration recognizes only the existing exact BAK reference identities and appends configuration; it does not create accounts, alter evidence, rewrite audit events or delete sites.

Tenant operational policy is snapshotted into new inspection results. A workflow change invalidates release eligibility until re-evaluation, while branding changes do not. The gate still reconstructs the current evidence, effective rules and original result and enforces independent approvals. Tenant freshness can be stricter than a ruleset limit, never weaken it. Older attempts remain reproducible under their original baseline; current mandatory checks and freshness are applied at release.

BAK's existing Twilio/VAPID environment names are retained only through its explicit bindings. Trip/booking notifications resolve their owning tenant. WhatsApp inbound webhooks use `/api/whatsapp/webhook/<tenant-slug>/` and validate that tenant's signature; the old path works only when one credentialled tenant is unambiguous. Conversations are unique per tenant/phone. Existing conversations are bound only when a trip or unique driver identifies the tenant; ambiguous history is retained.

Booking creation accepts `tenant` as the organisation slug. The legacy single-tenant path and existing authentication requirements remain available, but ambiguous multi-tenant requests cannot select the first organisation silently. Existing customer-reference/token lookup and tracking contracts are preserved.

To apply the reference to an existing tenant:

```powershell
cd backend
.venv\Scripts\python.exe manage.py configure_tenant --tenant bak-operations --manifest ../tenants/bak/tenant.json --reason "Apply reviewed BAK reference"
```

The operator command appends configuration when changed, creates missing declared sites and preserves existing site configuration and memberships. It requires the normal deployment audit/secret environment. It does not create users or verified regulatory rules.

## Preservation checks

| Validated prototype capability | Refactor treatment |
| --- | --- |
| PIN/email authentication, ADMIN working-role switching and refresh | Stable staff IDs, roles, token and identity contracts; tenant enabled-role enforcement added |
| Queue arrivals, dock/equipment operations, alerts | Existing models and endpoints retained; tenant capability restrictions enforced |
| Source/evidence/configuration review and effective rules | Existing immutable history retained; explicit shared catalogue added |
| Inspection, hold, override and independent release approval | Existing gate retained; tenant policy snapshot and change detection added |
| Audit verification/export, Reports and synthetic modelling | Existing APIs, reproducible fixtures and separation from operational writes retained |
| Route previews/drafts, reported position freshness, synthetic maps | Existing yard scope and verified interface behavior retained |
| Offline replay and practice mode | Existing outbox/database IDs retained; old practice-session key remains readable |
| Booking/tracking and notification workflows | Stable reference/token contracts; tenant selection and credential binding added |

The physical legacy PowerSync database name and old IndexedDB migration keys are retained to avoid discarding queued work. They are compatibility storage identifiers, not application-domain ownership. Existing retired Firebase/Node directories remain historical, outside the active Django/PWA runtime.

Verification and release evidence are recorded in `PRODUCTION_INTERFACE_VALIDATION.md`. Synthetic catalogue tests exercise sharing and revocation with invented documents; they do not certify law.
