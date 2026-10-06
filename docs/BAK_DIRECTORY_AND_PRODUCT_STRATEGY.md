# BAK directory and product strategy

Historical strategy. Superseded on 6 October 2026 by [tenant platform architecture](TENANT_PLATFORM_ARCHITECTURE.md): Trucki owns the application domain and BAK Logistics is its first configured tenant/reference implementation.

Date: 5 October 2026. Status: recommended reset following the repository audit. Application behavior and existing directories remain unchanged by this document.

## Strategic decision

Treat BAK as the immediate design/pilot customer for BAK INTEL. Treat N-ROK as the reusable regulatory domain and service boundary. Keep Trucki as a preserved broader platform opportunity and code lineage, with its fleet/booking roadmap outside the immediate BAK gate delivery unless BAK explicitly needs it.

These are three distinct responsibilities, not three independent applications to build:

| Name | Responsibility | Near-term proof |
| --- | --- | --- |
| BAK INTEL | Customer operational interface and configuration | One defensible gate-to-release journey reviewed by BAK staff/IT |
| N-ROK Transport | Contextual applicability, verified/versioned controls, decisions and evidence requirements | Pure reusable evaluator + authenticated service contract + historical reproduction |
| Trucki | Reusable multi-tenant platform and future fleet/yard product roadmap | Existing capabilities retained, without distracting the BAK delivery |

Keep tenancy, Django and the PWA. BAK can be a tenant/reference deployment without renaming every database table or baking BAK-specific legal assumptions into shared code. Brand/customer configuration belongs at the app boundary; regulatory content belongs in reviewed versioned data; business decisions belong in domain services.

The commercial proposition to test is an evidence-backed regulatory gate that complements BAK's ERP/WMS/TMS, with the existing yard interface as the usable reference implementation. A positive demo reaction is evidence of interest, not a concluded procurement process. The old pilot-closure statement should no longer lead the active implementation directory, but preserve it in its dated source for traceability.

## Directory rules

Do not rename the checkout, recreate the frontend, restore retired Firebase/Node servers, split microservices, move secrets or delete ignored local folders during this reset. The current `web/` + `backend/` + `docs/` layout is appropriate. Structure the next work around clear runtime and domain ownership.

Proposed incremental target:

```text
BAK/
  README.md                        # active strategy + runnable paths + audit evidence
  web/                             # existing React/Vite app
    src/
      components/                  # preserve UI identity
      routes/                      # preserve current paths
        regulatory/                # future registry/source/watch/passport views
      lib/
        api.ts                     # canonical transport
        offline/                   # identity/site-scoped durable replay
        regulatory/                # future typed contracts/offline conformance
        weighbridge/               # device boundary
      store/                       # session + canonical demo/context state
  backend/                         # existing Django platform
    core/                          # tenancy, auth support, audit/outbox
    yard/                          # operational models and command services
    trip/                          # existing fleet context; no duplicate Trip
    compliance/                    # compatibility endpoints / migration adapters
    regulatory/                    # future N-ROK domain + pure evaluator
    evidence/                      # future evidence lifecycle/access
    integrations/                  # future adapter contracts
  docs/
    README.md                      # current document authority/index
    BAK_EXISTING_SYSTEM_AUDIT.md
    BAK_REGOPS_UPGRADE_PLAN.md
    BAK_DIRECTORY_AND_PRODUCT_STRATEGY.md
    briefs/                        # supplied stakeholder requirements, dated
    audit/                         # reproducible observations and validation
    architecture/                  # future ADRs/as-built contracts
    regulatory/                    # future reviewed source records/provenance
    product/                       # future BAK scope/acceptance and separate Trucki roadmap
    reference/                     # non-runtime examples; clearly labeled
    archive/                       # dated lineage, never implied active authority
```

Future package paths are proposals. Do not create empty boilerplate folders merely to resemble this tree. Start with genuine modules and tests. Keep existing migration app labels stable; moving Django models between apps requires a carefully planned state/database migration, not a folder drag.

## Cleanup sequence

1. Establish document authority now: audit describes reality; supplied brief describes target; upgrade plan describes sequence; Trucki PRD/SAD provide previous scope/lineage. Add a visible entry point in README without rewriting historical documents.
2. Record a known baseline and retain old demo/site configuration separately from live operations. Do not change product name, staff IDs, browser database keys or origin URLs as a blind global replace.
3. Close release and configuration bypasses before presenting a production credibility claim.
4. Migrate Alerts practice operations and legacy analytics consumers onto canonical REST/demo services. Verify tests and bundle. Only then remove unused PowerSync/Firebase identity/data modules/dependencies/Firestore rules. Preserve relevant design references.
5. Inventory `server/`, `functions/`, `spotterAI/` and private deployment remnants with owner/path/recovery checks before cleanup. They currently contain local artifacts outside tracked active source; deletion is unnecessary for this audit and may destroy retained work. Never assume node_modules proves an active service.
6. Consolidate deployment docs around the actual chosen frontend/API hosts. Retire contradictory configs once deployment ownership and consumers are established. No broad hosting migration is justified by this audit.
7. Move dated Trucki specs to a product/archive location only as a separately reviewed doc change, updating every relative link. Until then the docs index explicitly identifies their status.

## Next BAK review package

Lead with a single domestic scenario and one exception scenario. Show why a vehicle is held, the rule/source/version, required evidence/remediation, independent authorization and the final release record. Label every assumed limit/source/evidence record DEMO/UNVERIFIED. Show integration boundaries and NOT_CONFIGURED honestly. Retain AFM 1187, ABZ 9901, ADP 3357 and AEW 7712 as scenario anchors, with real linked demo records rather than unrelated cards.

For internal IT: show server enforcement, tenancy boundaries, dependency versions, API contracts, offline reconciliation policy, backups/retention, audit limitations and test results including negative cases. Do not lead with a large menu of future screens or an AI feature.

Agree a narrow pilot success measure from BAK's actual baseline: completeness of captured inspections/evidence, resolution of exceptions, traceability of release and measured dwell. Avoid asserting monetary penalty savings until the legal formula, operational baseline and commercial pricing are validated. Renewed BAK work should have its own scope/status/commercial record; it should not silently inherit the old $6,200 pilot assumptions.

## Decisions still requiring stakeholder evidence

- Is this renewed demo preparation, a pilot with authorized yard users, or a procurement/IT review? No new contractual status is assumed.
- What does BAK already operate for ERP/WMS/TMS, identity and weighbridge equipment, and who owns integration access?
- Who verifies regulatory sources and approves activation, overrides and retention?
- Which functions must work offline, and what can legally/operationally authorize release during an outage?
- Which sites/corridors/cargo types belong in the first acceptance path?

These questions shape implementation scope, but they do not block the audit, test evidence, clear directory authority or removal of unsafe claims in the next implementation phase.
