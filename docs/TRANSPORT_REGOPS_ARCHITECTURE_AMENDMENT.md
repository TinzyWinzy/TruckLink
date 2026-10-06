# Transport RegOps architecture amendment

Date: 6 October 2026. Status: target architecture and gap assessment, not a claim that every capability below is deployed.

Implementation follow-through is recorded in [TENANT_RELEASE_IMPLEMENTATION.md](TENANT_RELEASE_IMPLEMENTATION.md). The assessment table below captures the foundation before that implementation; deployment and verification status remain explicit in the release evidence.

BAK Logistics is the first tenant and reference implementation of Trucki Transport RegOps. BAK's validated behavior is the compatibility baseline. Regulatory knowledge and reusable transport capabilities belong to the platform; company procedures and operational records belong to their tenant. No Trinitas tenant, account, site, integration binding, manifest or workflow configuration is to be created before operational discovery.

## Assessment of the deployed foundation

| Requirement | Current implementation | Remaining work |
| --- | --- | --- |
| Tenant data ownership | Organisation/site scoping, membership checks, protected relationships and tenant-scoped operational records | Extend isolation checks to each new module, attachment, export, cache, job and integration |
| Branding and permissions | Immutable tenant configuration revisions, role labels/enablement, restrictions within platform permission ceilings | Versioned permission profiles with site scope and explicit grants for new capabilities |
| Configurable modules | Existing screens and capabilities are permission gated | Module registry, dependency validation and server-side activation controls |
| Tenant workflows | Versioned mandatory checks, inspection freshness and escalation parameters | Immutable workflow definitions, bindings and execution records |
| Sites | Tenant-owned facilities and an operator manifest command; existing configuration preserved | Versioned site configuration, workflow bindings and a supported onboarding interface |
| Tenant policies | Internal-policy source classification and workflow parameters; catalogue rejects internal policies | Dedicated tenant-policy revision/publication model, separate from statutory sources |
| Regulatory packs | Shared immutable bundle publication and versioned tenant adoption/revocation | Platform-owned source/ROU/rule revision registry and richer effective-dated pack assignments |
| Integration adapters | Tenant-bound notification credentials and scoped WhatsApp conversations | Adapter registry and versioned bindings for additional supported providers |

The ownership gap matters: current `SourceRevision`, `RuleUnit` and `RuleSetVersion` inherit the tenant-owned `Record` model. `PlatformRuleBundle` shares a reviewed snapshot originating from those records. That preserves compatibility, but does not yet satisfy platform ownership of the full regulatory knowledge lifecycle. `RuleUnit` is the current ROU representation; a renamed concept alone would not fix its ownership.

## Ownership model

| Platform records | Tenant records |
| --- | --- |
| Regulatory sources and immutable source revisions, ROUs and ROU revisions, rule versions, regulatory-pack versions, independent reviews and publication/revocation events | Regulatory-pack assignments and assignment revisions |
| Module definitions, capability catalogue, workflow templates, typed condition/action definitions and adapter implementations | Enabled modules, permission profiles, workflow versions/bindings, site configuration, tenant policies and integration bindings |
| Core entity schemas and evaluator implementations | Vehicles, drivers, loads, trips, positions, evidence, evaluations, inspection attempts, approvals and releases |
| Platform catalogue governance and its separate governance audit | Tenant operational audit events, notifications, integration delivery records and offline commands |

Platform regulatory content must not include tenant evidence, vehicle ratings or operational identifiers. Manufacturer rating evidence remains private to the vehicle's tenant. Any reusable manufacturer reference material requires a separate, explicitly governed publication process.

BAK procedures have policy identifiers such as `bak.dispatch.required-attestations`, an owner, reason, effective dates and approval history. They are `TENANT_POLICY`, never statutory ROUs. Statutory and policy controls are evaluated in separate namespaces and retain their classification in decisions, reports and exports. A tenant policy cannot remove a statutory requirement, permit an override prohibited by it, or convert uncertainty into regulatory clearance. Permitted tenant controls can add holds or stricter requirements. Existing legally unverified content remains unverified.

## Versioned configuration model

Use typed records for configuration that needs ownership, publication, dates or execution history. A tenant release manifest references those immutable versions; it does not become an unrestricted JSON scripting system.

| Record | Principal fields and behavior |
| --- | --- |
| `ModuleDefinition` | Stable module key, supported configuration schema, capability requirements, dependencies and compatible template/adapter versions; implemented by platform code |
| `TenantModuleRevision` | Tenant, module key, revision, enabled state, validated settings and effective period |
| `WorkflowTemplateVersion` | Platform template key/version, allowed states, transitions, typed actions, evidence requirements and immutable content digest |
| `TenantWorkflowVersion` | Tenant, workflow key/version, template version, validated transition/step configuration, effective period, reviewer, reason and digest |
| `WorkflowBindingRevision` | Tenant, site or tenant-wide scope, trigger/event, workflow version and effective period; overlapping bindings are rejected |
| `SiteConfigurationRevision` | Tenant/site, revision, timezone, yard topology, operating parameters and effective period; site identity remains stable |
| `PermissionProfileVersion` | Tenant profile key/version, capability grants, site scope and separation-of-duty constraints; grants remain within platform ceilings |
| `TenantPolicyVersion` | Tenant policy key/version, applicability, typed controls, internal document provenance, effective period, independent approval and digest |
| `RegulatoryPackVersion` | Platform pack identity/version, jurisdiction/event applicability, exact source/ROU/rule revision membership, effective dates, reviews, publication and digest |
| `RegulatoryPackAssignmentRevision` | Tenant, optional site scope, jurisdiction/route/event scope, exact pack version, effective period, adopting actor and reason |
| `IntegrationBindingVersion` | Tenant, adapter/version, validated non-secret settings, operator-managed secret reference, permitted sites/capabilities and effective period |
| `TenantReleaseVersion` | Tenant, schema/release version, exact configuration references, branding, effective time, actor, approval/reason and canonical digest |
| `WorkflowExecution` / `WorkflowEvent` | Tenant/site/entity, pinned workflow/configuration references, state transitions, actor, idempotency key, timestamps and append-only event history |

Every operational execution records the tenant release, site configuration, workflow, policies and assigned regulatory packs that produced its behavior. Evaluations additionally record evaluator version, evidence revisions, inputs and result digest. Mutable entity metadata must not replace those historical snapshots.

Draft, review, publication and activation are separate operations. Publication validates dependencies, scope, schema, dates, references and reviewer authority. Activation selects one effective tenant release atomically, preventing a workflow update from racing with a partially applied policy or pack assignment. Branding-only changes do not invalidate operational decisions; changed decision-relevant configuration requires the existing re-evaluation rules. Configuration rollback is a new revision selecting earlier validated references, never deletion or historical mutation.

Site-specific bindings take precedence only where the template explicitly permits them. Ambiguous or overlapping effective assignments fail closed. Missing required packs return `CONFIGURATION_REQUIRED` or `REVIEW_REQUIRED`; they must not imply clearance. Ongoing executions remain pinned to their versions, while the release gate rechecks current effective regulatory authority, revocation, freshness and safety-relevant policy changes.

## Modules and workflows

Initial module definitions should describe existing capabilities: yard queue, docks/equipment, inspections, approvals/release, fleet/trips, route/map, notifications, reporting/modelling and audit. BAK enables every module needed by its validated stories. Module disablement controls API commands, scheduled jobs, replay and subscriptions as well as navigation. Historical records remain readable by authorized users when their module is disabled. Administration and required audit access cannot be disabled. A dependency resolver rejects changes that would leave an enabled workflow without its required controls.

Workflow configuration selects supported templates, states, transitions, evidence checks, escalation windows and approved actions. It cannot contain Python, JavaScript, SQL, arbitrary expressions, unrestricted URLs or an action that bypasses the operational gate. The evaluator and independent-person approval checks remain platform services. Start with the validated arrival, dock assignment, inspection, hold/remediation, exception approval and release templates rather than inventing a general-purpose workflow engine.

Separate module enablement from permission: an enabled module gives a tenant a capability, not every staff member access. Permission evaluation requires authenticated tenant membership, enabled capability, role/profile grant, site membership and action-level constraints. Tenant ADMIN manages its company; platform custodians govern shared regulatory publication. Switching a working role never creates a second person for approval purposes.

## Isolation and integrations

Resolve tenant identity from the authenticated server context. Tenant identifiers in payloads, URLs or offline storage cannot override that context. Public/customer integrations require an explicit tenant route or binding where ambiguity exists. Cross-tenant entity relationships must be rejected, including joins through workflow, policy, evidence, site and integration records.

Carry tenant and site context through database queries, attachment storage and signed links, search indexes, exports, cache keys, WebSocket/subscription channels, scheduled jobs, provider callbacks, idempotency keys and offline commands. A background job must not infer the tenant from the first organisation or a process-wide default. Operational audit chains remain tenant/site isolated; platform governance audit is a distinct authority boundary. Support access must be explicit, limited and audited.

Platform adapters define capabilities and request/response contracts. Tenant bindings choose an installed adapter and validated settings; credentials are resolved through operator-controlled secret references. Adding an already supported provider is configuration. Adding a new provider requires a platform adapter implementation, not a tenant fork. Provider failures must preserve the current outbox/retry behavior and cannot silently change regulatory decisions.

PostgreSQL row-level security is a useful additional control, but is not currently implemented and does not replace service authorization. It requires a separately tested connection-context design for web requests, workers and maintenance operations. Do not claim database-enforced isolation from the existing application checks alone.

## Preservation and migration

1. Freeze the BAK story inventory and production baseline. Map every validated operation to a platform capability, BAK module selection, workflow version, site binding and tenant policy. Do not infer unvalidated procedures as requirements.
2. Add configuration models and registries without renaming existing tables, replacing identities or changing client contracts. Treat the current BAK configuration as the initial compatibility release, retaining every required module and its current behavior.
3. Introduce the platform source/ROU/rule registry and separate tenant-policy registry. Classify existing records by their actual provenance. Internal policies remain tenant-owned; unreviewed sources are not promoted or labelled verified. Platform publication requires authorized independent review.
4. Link explicitly reviewed legacy regulatory records to new platform versions through an append-only migration map containing original IDs and digests. Keep legacy records and historical evaluation snapshots intact. Historical policies must not be rewritten as statutory records.
5. Introduce workflow execution/version bindings incrementally, running the original BAK stories against each migrated template. Preserve independent approvals, release gates, offline replay, audit verification, routing, reports and notification contracts.
6. Activate a complete BAK tenant release after reconciliation and regression checks. Record source/configuration mappings and production verification. No second production tenant is created during this work.

## Onboarding contract

After operational discovery, an operator provisions tenant identity and sites, assigns memberships and permission profiles, selects supported modules/templates, configures company policies, assigns reviewed regulatory packs, binds integrations and applies branding. Validate and publish the release, then run that tenant's acceptance stories before operational activation. Missing discovery information remains unresolved; BAK settings are not silently copied into another company.

Supported transport/distribution operating models must be onboarded through these records and existing platform adapters, without branches, tenant-specific frontend builds or changes to core domain code. A genuinely new domain capability still requires a platform extension; configuration cannot promise support for an undiscovered business process.

Synthetic second-tenant fixtures may be used to prove isolation and configurable behavior. They are disposable tests, not a customer implementation or a substitute for discovery. No Trinitas-specific fixture or configuration is needed.

## Acceptance gates

- Every validated BAK story passes with the same outcome and preserved identities/history.
- Two disposable tenants can use different modules, sites, policies, workflow bindings and branding without tenant-specific code paths.
- API, job, attachment, export, integration callback and offline-replay tests reject foreign tenant/site identifiers.
- Disabled modules deny new commands on the server; required workflow dependencies cannot be removed; historical reads remain authorized.
- Evaluations reproduce from pinned evidence and configuration, while expired/revoked authority and safety-relevant changes block release until re-evaluation.
- BAK internal controls remain visibly tenant policy in interfaces and exports; statutory packs contain no internal policies or private operational evidence.
- Configuration publication rejects stale writes, invalid references, overlapping assignments, unsupported actions and grants above platform ceilings.
- No second production tenant or Trinitas configuration exists before discovery.

The deployed foundation and its test evidence are described in [TENANT_PLATFORM_ARCHITECTURE.md](TENANT_PLATFORM_ARCHITECTURE.md) and [PRODUCTION_INTERFACE_VALIDATION.md](PRODUCTION_INTERFACE_VALIDATION.md). This amendment defines the next implementation boundary; it does not supersede their truthful release status.
