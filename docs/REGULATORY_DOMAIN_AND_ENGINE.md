# Regulatory provenance, domain and gate foundation

Implemented 5 October 2026 in the existing Django/React application. No regulatory source is seeded, automatically verified, or asserted to be law. No operational monetary penalty is calculated.

## Records and authority

`backend/regulatory/` adds protected append-only records. Sources have a stable key, numbered revisions, jurisdiction, instrument/authority/provision, source tier, document reference and SHA-256, publication date and effective date window. Source kinds distinguish STATUTE, INTERNAL_POLICY and MANUFACTURER. Creation, including tier-D extraction, starts UNVERIFIED. A separate review records approve/reject, reason, actor and time. The latest independent review determines current eligibility; rejection does not rewrite earlier reviews or evaluations.

Rule units reference exact source revisions and a restricted schema-v1 definition. Ruleset versions contain exact unit/source snapshots, scope, inclusive UTC effective dates, schema version, freshness policy and canonical SHA-256 digest. Independent publication records review of the control definitions and activates the version for its effective window. Publication rejects unreviewed sources, windows outside source applicability, self-review/control-author review and overlapping published windows for the same tenant/jurisdiction/route scope. Draft creation alone cannot activate a version.

Evidence revisions record issuer, document reference/digest, issue and exclusive expiry time, and exactly one vehicle/driver/trip/load entity. Review is separate from collection. Metadata and reviewer attestation do not mean this application downloaded or authenticated the underlying document. Uploaded-file storage, issuer verification adapters and vault UI remain subsequent work.

Vehicle configuration revisions hold ordered axle position/kind, rated axle and gross masses, vehicle class and effective dates. They reference VEHICLE_RATING evidence for that exact vehicle. Both the document and configuration require independent review. Caller-entered GVM, pilot limits and fleet fuel fields cannot become operational ratings.

Loads hold cargo class, declared decimal mass and optional integer millimetre dimensions. Operational context revisions connect a queue arrival to configured vehicle, existing Driver/Trip, Load, explicit route type, traversed jurisdictions, origin/destination and exact evidence revisions. Trip assignments and registration must agree. A context correction appends a new record and invalidates prior gate eligibility. This context history supplies the linkage proposed in the upgrade plan without inventing matches or rewriting legacy queue/vehicle records.

Inspection attempts snapshot measured inputs, resolved context/evidence, exact rule bundles, per-control outcomes, original decision, actor/time and engine version. Re-evaluation appends another attempt. OverrideRequest and OverrideApproval are separate immutable records. Approval cannot alter the original inspection decision. ReleaseRecord binds gate exit to the current attempt and optional permitted independent approval.

Tenant/site checks apply to operational commands. Registry authoring and review require ADMIN/COMPLIANCE_OFFICER; inspectors are DISPATCH_SUPERVISOR; override commands require OPERATIONS_SUPERVISOR/ADMIN. Release retains the existing queue-release roles. Foreign references and incompatible entity relationships are rejected. Protected FKs prevent ordinary cascades from erasing recorded evidence/history. Application guards reject model/queryset update/delete and bulk mutation; database administrator access still requires its own security and retention controls.

## Evaluator and policy

The pure Python evaluator has no Django, network, HTTP or LLM dependency. Canonical JSON is sorted, compact and rejects nonfinite numbers. Masses are decimal kilograms, stored as strings in snapshots; booleans, negative and nonfinite values are rejected. Inputs specify measured axle/gross masses and actual checklist attestations, never regulatory limits or vehicle ratings.

Schema v1 supports:

| Kind | Required parameters | Meaning |
| --- | --- | --- |
| AXLE_MAX | `limits_kg` vector | Compare ordered axle measurements with configured limits |
| GROSS_MAX | `limit_kg` | Compare measured gross mass with configured limit |
| EVIDENCE | `evidence_kind`, `subject` | Require reviewed, unexpired evidence for vehicle/driver/trip/load |
| CHECKLIST | `item_id` | Require a literal true attestation |

Every unit also requires `applicability` (explicit vehicle_class/cargo_class sets or an empty object), `failure_action` (HOLD/QUARANTINE/PASS_WITH_WARNINGS), and `override_policy` (NOT_ALLOWED/INDEPENDENT_APPROVAL). Unknown operators, arbitrary code, undocumented fields and malformed limits are rejected. Unsupported legal controls must be implemented and tested before they can be represented in a published bundle; this foundation is not a complete statutory rule library.

The gate also checks evidenced manufacturer axle/gross ratings, measurement sum consistency within an explicit 1 kg operational capture tolerance, and the existing mandatory operational attestations. Rating/configuration, evidence and attestation blockers cannot be overridden. These controls are versioned operational policy, not claims about statutory tolerances.

Each traversed jurisdiction requires exactly one currently published, reviewed bundle for the recorded route type. Missing/unreviewed/expired/incompatible configuration produces a recorded REVIEW_REQUIRED outcome, never pilot fallback. A bundle with no applicable control also blocks. Decision precedence is REVIEW_REQUIRED, QUARANTINE, HOLD, PASS_WITH_WARNINGS, PASS. Readiness is an equal-weight percentage of applicable controls; it never authorizes release.

At exit, the transactional release service locks the queue/site/tenant, rechecks context, evidence reviews/expiry, effective rules and freshness, and reproduces the result under its recorded engine. Changed evidence or rules, a newer context/attempt, an expired inspection, a forbidden override or self-approval blocks exit. Release time, dwell, release authority record, audit append and delivery outbox event commit together. The original failed result survives a permitted exception.

## API workflow

All routes require the existing token authentication. Registry operations are organisation-scoped; queue/attempt commands additionally require site membership. No PATCH/DELETE route exists for these regulatory records.

| Endpoint under `/api/regulatory/` | Operation |
| --- | --- |
| `sources/`, `evidence/`, `vehicle-configurations/`, `loads/`, `rule-units/` | GET tenant registry; POST immutable record |
| `reviews/` | POST independent review: subject source/evidence/configuration, subject_id, approved, reason |
| `rulesets/` | GET versions; POST name/version/jurisdiction/route_type/effective dates/max_age_seconds/unit_ids |
| `rulesets/{id}/publish/` | POST independent publication reason |
| `queue/{id}/context/` | GET current context/readiness/attempt; POST configuration/driver/trip/load/route_type/jurisdictions/origin/destination/evidence_ids |
| `evaluate/` | POST strict measured inputs; record attempt including configuration blockers |
| `attempts/{id}/` | GET original result and separate request/approval history |
| `attempts/{id}/override-request/` | POST exception reason, only for eligible current blockers |
| `override-requests/{id}/approve/` | POST approved boolean and independent reason |

The existing `/api/queue/{id}/release/` now selects the versioned authority when operational or a versioned attempt exists. The old `/api/compliance/` contract remains isolated to explicit LEGACY_DEMO sites without recorded regulatory context; it cannot authorize an operational gate. The compliance screen selects the versioned workflow from server context, shows recorded ratings and source/control results, and preserves the entry link during session restoration.

Example operational submission (IDs must already refer to authorized records):

```json
{
  "queue_entry": 10,
  "context_id": 5,
  "axle_weights": ["6000", "8000", "8000"],
  "total_weight": "22000",
  "client_key": "inspection-device-unique-key",
  "checklist_results": {
    "driver-license": true,
    "vehicle-reg": true,
    "cargo-manifest": true,
    "weight-cert": true,
    "axle-calc": true
  }
}
```

Replay is facility-scoped and bound to the normalized payload and actor. Identical retries return the original attempt; mismatched ownership/payload/context conflicts. A recorded context ID prevents applying an old submission to a replacement context. Legacy outbox submissions hitting an operational site remain blocked for reconciliation rather than being silently converted. New versioned inspection is online only in this delivery; no offline assessment or offline gate authorization is claimed.

## Migration and validation

Apply the existing stabilization migration `yard/0005`, then `regulatory/0001` and `0002`. These create empty regulatory tables; they do not backfill VERIFIED sources, ratings, evidence or regulatory releases. Existing legacy history is preserved. No customer/local database has been migrated in this session. Obtain the safe inventory/backup and deliberately create/review site context and source data before operational use.

Tests use invented INTERNAL_POLICY sources, `test://` references and synthetic thresholds. They test software authority without asserting any instrument or monetary penalty to be verified law. PostgreSQL concurrency, real device capture/calibration, document-byte storage/verification and regulator/ERP connections require separate validation. Source/unit review and BAK operational approval remain human responsibilities.

Recorded test outcomes are maintained in `BAK_IMPLEMENTATION_PROGRESS.md`.
