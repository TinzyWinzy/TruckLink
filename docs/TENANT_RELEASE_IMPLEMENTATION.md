# Tenant releases and platform regulatory knowledge

Implemented 6 October 2026. This extends the deployed tenant foundation described in `TENANT_PLATFORM_ARCHITECTURE.md` and implements the configuration boundary in `TRANSPORT_REGOPS_ARCHITECTURE_AMENDMENT.md`. Production deployment evidence is maintained separately in `PRODUCTION_INTERFACE_VALIDATION.md`.

## Configuration records

`TenantArtifactRevision` is a discriminated, append-only record with tenant, optional site, kind, stable key, version, effective period, actor, reason, content and digest. Each kind has a strict schema in `backend/tenancy/registry.py`; unknown fields, executable code, unsupported templates/actions and foreign references are rejected. The conceptual module/workflow/site/permission/policy/assignment/integration record types share this envelope rather than seven duplicated database models.

| Kind | Supported configuration |
| --- | --- |
| `MODULES` | Enablement for yard, docks, inspection, release, fleet, routing, notifications, reports, modelling and audit; dependency validation; audit cannot be disabled |
| `WORKFLOW` | Versioned `yard-lifecycle-v1` template binding, supported transition subset, mandatory checks, freshness and escalation settings; independent review required |
| `SITE` | Existing tenant site identity, supported timezone and operating parameters; operational sites cannot be downgraded to demo controls |
| `PERMISSIONS` | Capability restrictions within platform ceilings, tenant-wide or site-specific; restrictions are intersected, never added above platform grants |
| `POLICY` | Explicit `TENANT_POLICY` classification, internal document reference/hash and supported typed controls; independent review required; no new regulatory override permission |
| `PACK_ASSIGNMENT` | Exact platform pack revision, jurisdiction and route type, optionally scoped to a site; assignment effective period is the artifact period |
| `INTEGRATION` | Installed Twilio, web-push or road-routing adapter, enabled state and operator-managed environment prefix; no secret values or arbitrary provider URLs |

Platform module, workflow-template and adapter implementations are a versioned code registry. Tenant configuration selects supported behavior. Adding another company does not require changes to core domain code; genuinely new templates, domain capabilities or providers are platform extensions. This implementation starts from the authoritative existing yard services, not a user-scriptable state-machine interpreter.

`ArtifactReview` appends approval/revocation by a different authorized tenant reviewer. `TenantReleaseVersion` binds an exact base `TenantConfiguration` revision and an exact list of artifact IDs. It is publishable only when references, schemas, scope, dependencies and required reviews validate. `ReleaseActivation` atomically selects a published release using a tenant lock and expected activation version. Publishing a draft artifact or release changes no active behavior. Rollback selects an earlier valid release through a new activation; revoked or expired authority still cannot be activated.

Site-specific workflow bindings override the tenant-wide workflow default. Site permissions narrow tenant-wide grants. Duplicate scoped bindings, competing artifact revisions and ambiguous adapter/pack assignments are rejected. Effective site revisions apply timezone/operating mode to the stable facility identity at activation; prior values remain in immutable revision history.

Identity/configuration responses include `modules` and `release` metadata. `digest` identifies the base configuration revision; `effective_digest` identifies resolved content after the selected workflow/permission/integration revisions. Branding and role-label edits append a base configuration and atomically publish/activate a release retaining the same operational references. Decision digests exclude branding, module enablement, permissions and adapter metadata; authorization still checks their current state. Workflow/site/policy/assignment changes require re-evaluation before release. Active operational settings are edited through independently reviewed workflow revisions, not the old branding form.

## Operational enforcement and history

Module checks run in token/session authentication, relevant view permissions, authoritative audit/command hooks, notification delivery and incoming fleet messaging. Disabling notifications retains pending outbox rows and attempts for later delivery. Disabled modules deny new operational commands while authorized historical API reads remain available. Frontend navigation reflects active enablement; it is not the authorization boundary. Site-specific permission restrictions are applied to yard and regulatory commands.

`WorkflowExecution` pins a queue entry to its tenant/site, release, workflow and configuration snapshot. `WorkflowEvent` appends the authoritative transition/state, actor, audit reference and current configuration snapshot. Repeated audit IDs and existing command replay guards preserve idempotency. State changes still go through existing queue, inspection, independent override and release services; configuration cannot release an uninspected or unapproved vehicle.

New inspection attempts record `tenant_configuration_snapshot`. Evaluation and gate checks preserve exact evidence/ruleset snapshots and additionally compare current decision-relevant configuration, effective dates and review revocation. Readiness failures remain recorded as review-required attempts; no workflow or legal clearance is invented. Ongoing executions retain their workflow version, while release gates recheck current operational and regulatory authority.

New tenant signup/self-service workspaces have `requires_release=True`. Operational modules remain unavailable until an explicitly published release is activated following discovery. Existing organisations preserve their previous contracts until explicit migration. No second production tenant or Trinitas configuration is created by this change.

## Platform regulatory registry

`KnowledgeRevision` has strict `SOURCE`, `ROU` and `PACK` schemas and no organisation foreign key. Statutory source versions retain authority, provision, jurisdiction, document hash and publication/effective dates. ROUs reference exact platform sources and use the existing restricted rule schema. Packs snapshot exact ROU/source membership, scope, effective dates and freshness limits. Independent `KnowledgeReview` records approve or revoke revisions; pack publication rechecks approved ROUs/sources and full date coverage. Tier D extraction remains proposed and cannot be approved as statutory authority.

Only active platform custodians may author, review or import this knowledge. Tenant ADMIN is not a platform custodian. Company procedures cannot enter the statutory registry. Manufacturer vehicle-rating evidence stays tenant-owned. The separate `GovernanceEvent` hash chain records platform authoring/import/review/revocation, while operational audit chains remain tenant/site-owned.

`LegacyKnowledgeMap` records original type/ID/digest and the new platform revision. Import requires an explicit custodian command through the API, retains original records and creates drafts without copied approvals. No source, ROU or pack is automatically published. New statutory source/ROU authoring through the legacy tenant HTTP registry is rejected; historical tenant records and their evaluations remain readable and reproducible. Legacy rulesets continue to support validated flows until explicit assignment/import.

New tenant policy controls use `policy:<id>` namespaces, retain `INTERNAL_POLICY` / `TENANT_POLICY` provenance in evaluation exports and cannot loosen platform regulatory controls. An inapplicable tenant policy does not masquerade as a missing statutory jurisdiction. Existing BAK compatibility controls retain their earlier evaluator representation until a reviewed operational release replaces it.

## BAK compatibility migration

The migration recognizes only the existing exact BAK reference organisations. It selects their existing configuration, enables every validated module, freezes current workflow/permission settings and existing site configuration, and creates an explicitly labelled tenant policy for required attestations. Its internal policy hash identifies the canonical workflow section referenced by `tenants/bak/tenant.json#configuration.workflow`, not a newly claimed legal document. Existing Twilio/VAPID names remain explicit BAK bindings.

These system migration records are labelled compatibility preservation. They do not fabricate individual approvals or statutory verification. No existing identities, evidence, audit events, attempts, releases, sites or queued offline commands are deleted or rewritten. Migration execution is idempotent; reverse migration retains history. The initial compatibility release preserves old evaluation/gate semantics, including older valid attempts. Subsequent reviewed operational releases use the additional configuration/policy controls.

## APIs and onboarding

| API | Behavior |
| --- | --- |
| `GET /api/tenant/registry/` | Supported module/template/adapter registry, current release and activation version |
| `GET/POST /api/tenant/revisions/` | Tenant/site-scoped revision listing and ADMIN authoring with expected version |
| `POST /api/tenant/revisions/<id>/review/` | Independent ADMIN/COMPLIANCE approval or revocation |
| `GET/POST /api/tenant/releases/` | Published manifests and validated ADMIN publication |
| `POST /api/tenant/releases/<id>/activate/` | Atomic ADMIN activation with expected activation version |
| `GET /api/tenant/executions/` | Authorized tenant/site workflow execution/event history |
| `GET/POST /api/regulatory/knowledge/` | Shared regulatory revision listing; custodian authoring |
| `POST /api/regulatory/knowledge/<id>/review/` | Independent custodian review/revocation; pack publication on approval |
| `POST /api/regulatory/knowledge/import-legacy/` | Explicit original-to-platform draft mapping |
| `GET /api/regulatory/governance-audit/` | Custodian-only platform governance chain |

The live Admin screen supports authoring exact configuration revisions, selecting release references, independent review, publication and activation. Its schema-controlled editor is intended for tenant administration. Review author and reviewer identities must be distinct, regardless of working-role switching.

After discovery: provision the organisation/sites/memberships, apply identity/branding configuration with `configure_tenant`, author supported configuration and assign reviewed packs, review the workflow/policies, publish and activate the release, then run the company's acceptance stories. An operator may use `publish_tenant_release --tenant <existing-slug> --manifest <reviewed-file> --author <existing-admin> --reviewer <different-authorized-user> --reason <recorded-reason> [--activate]`. The manifest requires `schema_version: 1` and an `artifacts` list containing `kind`, `key`, `content` and optional existing `site_slug`. It creates no accounts or regulatory knowledge and cannot invent reviewer identity. Integration binding authors must also be platform operators.

## Verification and limits

The full non-live backend suite passed 656 tests before final isolation refinements. A subsequent 152-test auth/yard/gate/regulatory/tenant regression group passed. The amendment tests cover migration preservation, schema/dependency rejection, module denial, retained outbox work, pinned execution, policy review/hold, platform pack adoption/revocation, foreign references, governance access and branding-only compatibility. Additional final checks cover site precedence/permissions, workflow revocation without lost audit, discovery-gated registration and rejecting policy-to-statute import/site downgrades. The existing real API/browser stories passed under a disposable migrated BAK release: three releases and the missing-jurisdiction hold, with four workflow executions and three release transitions.

The final regulatory/RBAC/routing/amendment regression group passed 320 checks, followed by all 15 final amendment tests, including explicit statute import retaining the original digest and creating an unapproved platform draft, and the real configuration API's independent-review/publication/activation sequence. These are software tests using invented documents, not legal-verification evidence.

All 63 frontend units and 20 practice browser journeys passed. Two synthetic tenant interface tests passed, including separate authoring/publication/activation and module navigation updating only after activation. Build and lint passed, with the pre-existing Fast Refresh warning. Synthetic fixtures certify software behavior only; no instrument or monetary penalty is asserted to be verified law.

Database row-level security, new provider provisioning, new workflow/domain capabilities and customer-specific discovery remain separate work. Current isolation is enforced by authenticated service boundaries, scoped queries, validated references, retained history and tests; it is not a claim of database-level RLS. Future attachments/jobs/exports must inherit the same ownership rules rather than adding unscoped storage or background execution.
