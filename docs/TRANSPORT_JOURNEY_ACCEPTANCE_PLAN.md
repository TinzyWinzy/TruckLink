# Registration to destination: journey acceptance plan

Date: 7 October 2026. Proposed acceptance contract and initial gap assessment. This is not a claim that the full journey is implemented or production validated.

## Context and scope

Tariro's feedback is about Trinitas, whose incumbent reportedly covers HR, accounting, driver/truck/route analytics, fuel and P/L. BAK remains the first configured reference tenant. Do not infer BAK's incumbent capabilities from Trinitas, or create a Trinitas tenant before discovery. The user additionally reports that these clients already have fleets and tracking systems integrated with their ERP; exact products, interfaces and data rights remain unknown.

Test the platform as an operational participant in that estate. Existing commercial/master-data/telematics ownership must be agreed rather than recreated. Tracking a vehicle, executing a trip, handling a shipment and authorising a yard departure are related but distinct. A registration plate is not a reliable end-to-end journey key; a tractor may change trailers, loads or journeys. One vehicle may carry several consignments and visit several sites.

## Proposed common identity

Each test journey needs tenant-scoped correlation among external ERP dispatch/shipment IDs, platform journey/trip ID, yard visit ID, existing vehicle/driver IDs, trailer/configuration where relevant, load/consignment IDs, tracker/device mapping, inspection attempt IDs, release record ID and eventual delivery evidence. Preserve the provider's original IDs and timestamps. Define external identity ownership and uniqueness before implementation. Vehicle registration is a searchable attribute, not the linkage contract.

The initial acceptance cohort should include a normal delivery, a held and re-inspected load, and a changed assignment after inspection. Further cases cover multiple stops/consignments, return/rejected delivery and cancellation. These are synthetic scenarios in a disposable environment until real sample contracts and authorised sandbox access are available.

## User and service actors

These are business personas to discover and test, not automatically new application role codes. Use distinct real test identities for independent approvals. An ADMIN switching working role cannot impersonate another approver.

| Actor | Journey task | Required negative check |
| --- | --- | --- |
| Tenant administrator | Configure authorised sites, users, modules and integration binding | Cannot govern statutory knowledge merely by holding tenant ADMIN; cannot see another tenant |
| ERP/transport planner | Supply dispatch, assignment and destination; communicate changes | Cannot overwrite inspection/release history or silently cancel an executed movement |
| Gate/registration operator | Identify expected arrival; register and correlate the visit | Cannot release without authority or attach a foreign tenant's order |
| Yard/dock supervisor | Allocate dock; record arrival at dock and loading progress | Cannot occupy an unavailable dock or bypass holds |
| Weighbridge/inspection operator | Attach attributable measurements and inspection evidence | Cannot fabricate a provider observation or self-approve an exception requiring independence |
| Compliance reviewer | Review evidence, resolve authorised exceptions and reconstruct decisions | Cannot override non-overridable controls or approve their own request |
| Facility manager | Monitor unresolved holds, dwell and escalation ownership | Cannot convert a stale inspection into a fresh one through a dashboard action |
| Departure/gate officer | Verify current release authority and record actual exit | Cannot treat commercial dispatch approval as regulatory clearance |
| Driver | Confirm assigned job/operational events and report exceptions through the agreed channel | Cannot change someone else's trip or turn a self-reported delivery into independently accepted POD |
| Control-room/fleet operator | Monitor the existing tracker feed, freshness and exceptions | Cannot present stale location as current or an unverified route as truck-safe |
| Destination receiver | Confirm arrival, quantities/condition and accepted or rejected delivery | Cannot use source-yard release as evidence of delivery |
| Customer/consignee viewer, if needed | View authorised shipment progress | Cannot enumerate other shipments or see internal approvals and personal driver data |
| Finance/reconciliation user | Consume accepted delivery/reference/status in the incumbent ERP | Cannot treat a Trucki completion status as automatic invoice payment or recalculate authoritative P/L |
| Executive | Read traceable operational measures and drill into exceptions | Cannot edit operational evidence or grant release |
| Integration service/operator | Ingest ERP/tracker/weighing events and reconcile acknowledgements | Cannot use broad staff privileges or replay another tenant's event |
| Platform regulatory custodian | Maintain independently reviewed shared source/ROU/pack versions | Cannot read customer operational evidence merely because they govern shared knowledge |

Current UI role codes cover DISPATCH_SUPERVISOR, OPERATIONS_SUPERVISOR, FACILITY_MANAGER, COMPLIANCE_OFFICER, EXECUTIVE and ADMIN. Legacy driver/customer APIs are separate. Planner, receiver, integration and finance personas require explicit discovery of the existing application permission model; do not claim dedicated complete interfaces for them.

## Journey tests

| ID | Stage and handoff | Acceptance evidence | Current assessment |
| --- | --- | --- | --- |
| J01 | ERP dispatch -> expected arrival | Stable external reference, tenant/site, version, assignment and destination; replay creates no duplicate | ERP connector and external mapping not demonstrated |
| J02 | Expected arrival -> registration | Operator resolves the same journey, records actual arrival and identity mismatch explicitly | Yard registration exists; durable dispatch/trip linkage is missing |
| J03 | Registration -> dock | Same visit/journey, authorised dock allocation and attributable timestamps | Yard allocation exists; unified journey context needs linkage |
| J04 | Dock -> weighing/inspection | Measurement origin, observation time, configuration, load and evidence attached to the correct visit and journey | Inspection/provenance foundation exists; hardware feed not demonstrated |
| J05 | Inspection -> hold/remediation | Recorded reasons, owner, notification, independent review where applicable and new inspection attempt after material change | Supported yard/regulatory foundations; integration handoff unproven |
| J06 | Readiness -> release -> actual departure | Fresh authority, permitted actor, release ID and separate physical exit observation; ERP acknowledgement recorded | Release service exists; linked trip/departure/ERP acknowledgement not demonstrated |
| J07 | Departure -> in-transit monitoring | Existing tracker feed associated with correct vehicle/journey; provider event ID, observed/received times and visible freshness | Position API/map exists; live provider adapter and correlated timeline absent |
| J08 | Transit exception -> resolution | Late/stale/deviating movement handled under agreed tenant policy, assigned owner and recorded response | Generic position/status features do not establish this full workflow |
| J09 | Destination arrival -> unloading | Arrival is distinct from delivery acceptance, location observation is attributable, each stop/consignment identified | Trip status/destination fields exist; receiving workflow not demonstrated |
| J10 | Unloading -> accepted/rejected/partial delivery | Receiver identity, quantities/condition, evidence and discrepancy ownership; no geofence-only delivery claim | Delivered status exists; authoritative POD/partial delivery workflow not demonstrated |
| J11 | Delivery -> ERP reconciliation | Idempotent status/evidence references, acknowledgement, retry/reconciliation and visible unresolved mismatches | ERP round trip missing |
| J12 | Journey -> audit/management review | One correlated timeline from order to destination, drill-through to evidence/actors/source versions | Separate histories exist; one coherent journey view not demonstrated |

Warehouse/dock completion, regulatory readiness, actual gate exit, arrival at destination, accepted delivery and financial settlement must remain distinct events. Do not overload COMPLETED, RELEASED, delivered or paid to imply another event occurred. A source-yard visit may end while its trip continues.

## Cross-cutting failure scenarios

1. Duplicate and out-of-order ERP/tracker events: deduplicate by source identity; preserve observed and received times; do not regress current state from an older observation.
2. Tracker silence, invalid coordinates, impossible jump or device reassignment: show evidence quality and freshness, preserve last trustworthy observation, apply agreed policy without inventing location.
3. Vehicle/driver/trailer/load/route change after inspection: retain history and invalidate affected departure readiness; new checks follow applicable authority.
4. Offline gate registration and later sync: preserve idempotency and tenant/site scope; conflicting external assignment needs explicit reconciliation. Do not invent an offline regulatory clearance.
5. ERP or provider outage: expose last sync/acknowledgement and queued failures; an unavailable dependency must not appear successfully reconciled. Agree any permitted degraded operation with stakeholders.
6. Session expiry, role change and shared-device handover: renew/restore authorised identity safely; clear private context on sign-out; do not leak the previous tenant/site.
7. Cross-tenant/site references and source spoofing: reject foreign IDs and unauthorised source claims through APIs, exports and service ingestion.
8. Cancellation, rejected destination, partial delivery, multi-stop delivery, return and breakdown/substitution: preserve the original journey and obligations; prevent premature completion.
9. Concurrent dock allocation, approval and departure commands: enforce authority atomically; replay yields the original result rather than a second operation.
10. Retrospective corrections and rule changes: retain original evidence/decisions and record amendments; never rewrite an historical release using today's rules.

## Initial source findings

- `backend/yard/models.py`: QueueEntry stores registration, driver name and expected destination as text. No durable Trip relationship was identified in this model.
- `backend/trip/models.py`: Trip separately references Vehicle, Driver and optionally Facility, with its own status and position history. A shared facility does not correlate a specific visit to a trip.
- `backend/yard/services.py`: release records and outbox events reference queue entries; a correlated trip/ERP acknowledgement is not established by this service.
- `backend/trip/views.py`: delivered sets actual_end and records a TripStatusLog. That code path alone does not require accepted proof of delivery.
- `backend/trip/serializers.py`: position ingestion accepts coordinates and a caller-supplied source label; an authenticated provider-ingestion contract with external event/observation identity must not be inferred from it.
- `backend/tenancy/registry.py`: installed adapters cover notifications and road routing; ERP/telematics adapters are not installed by that configuration foundation.

These findings explain the perceived disjointedness more directly than screen count. Tests of the separate subsystems cannot certify J01-J12 as one passing operational story.

## Execution and implementation sequence

First run existing role, yard/story, trip and tenant-isolation regressions in a disposable database and existing practice role journeys. Record those as subsystem verification, with missing integrated scenarios explicitly BLOCKED or NOT IMPLEMENTED. No customer ERP/tracker or production records should be mutated for discovery testing.

Then agree the identity/ownership and event contract with operations and IT. Implement and test one vertical slice: ERP reference -> registered visit -> dock -> inspection -> release -> correlated trip -> existing tracker observations -> receiver confirmation -> ERP acknowledgement. Use invented evidence and a simulator for contract tests, followed by an authorised real sandbox check; distinguish these evidence levels in every report.

Only after that slice passes expand the exception/multi-stop matrix and additional personas. Preserve current BAK workflows, tenant isolation and the separation between tenant procedure and statutory authority. The test plan does not authorise new production tenants, integrations, legally verified rules or financial claims.

## Verification run, 7 October 2026

45 backend checks passed in 27.08 seconds across `test_admin_role_switch.py`, `test_cross_tenant.py`, `test_route_workspace.py`, `test_api_trip_management.py` and `test_story_api.py`. Nine existing practice browser checks passed in 13.9 seconds across `login-roles.spec.ts`, including all six role tabs/landings, permission denial, refresh and administrator-only working-role switching. Backend checks used a disposable test database; browser role checks used the practice harness. These are existing subsystem tests, not real Trinitas identity acceptance or production ERP/tracker validation. J01-J12 remain at the individual implementation assessments above; no complete journey pass is claimed.
