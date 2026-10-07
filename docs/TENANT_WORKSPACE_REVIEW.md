# Tenant workspace review clarification

7 October 2026.

Trucki is a reusable, tenant-aware Transport RegOps platform. BAK Logistics is its first configured reference tenant. Trinitas is a prospective company pending discovery, not a configured tenant or a platform default. Company-specific names should appear only as the selected tenant's branding and assigned site records.

The operational review describes a particular tenant workspace. Its missing fleet context, trips, loads and dock configuration are onboarding/data-readiness gaps. They do not establish that Trucki is a single-company application. Loading, audit readability, guided administration and provider limitations are platform usability/capability findings that should be tracked separately.

## Interface correction

- Navigation and the walkthrough use the configured tenant display name, falling back to the authenticated organisation name when branding is absent. Trucki remains the product name. The site selector continues to show actual assigned site records; existing customer names and memberships are preserved.
- Dock board uses the selected site's name. The hardcoded `72,000 m²` claim was removed. No yard area is asserted without a supported verified configuration source.
- Alerts, Audit and Docks distinguish initial loading, failed reads and confirmed empty results. They no longer show reassuring empty messages before the first successful response. Later feed failures retain visible stale-data warnings.
- Alert escalation wording refers to the tenant workflow instead of hardcoded prototype timings.

No new tenant, operational practice case, law verification, routing provider or ERP/tracker connection is introduced. Other findings in the review remain separate follow-up work; these UI changes do not establish a successfully completed customer dispatch lifecycle.

## Verification

86 frontend checks passed, including loading/failure/empty-state coverage and a differently named example tenant/site. Build and lint passed with existing Fast Refresh and bundle warnings. Backend code and tenant operational records are unchanged. Production release verification is recorded below after deployment.
