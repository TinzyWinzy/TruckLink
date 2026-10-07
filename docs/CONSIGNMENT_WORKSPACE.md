# Customer consignments and connected movements

Trucki now groups truck movements under a customer consignment. The workflow takes inspiration from Morres Logistics' parent bookings, multiple loads and checkpoint views, while using Trucki's existing tenant ownership, retained plans and authoritative journey services.

## Operator flow

1. Open **Consignments** and record the customer, order reference, goods, target quantity, exact unit and optional delivery deadline. A manually retained ERP reference is identified as manual.
2. Prepare each vehicle/driver/trip through **Dispatch flow**, link the origin visit, and record its delivery plan in **Deliveries & exceptions**. Existing operational visits remain usable without customer consignments.
3. In the customer dossier, allocate the appropriate delivery-plan line before release. The server reads its quantity and unit; the browser cannot supply a replacement quantity. One order can span several trucks or delivery stops.
4. Use **Open movement** to follow the existing inspection, independent approval, release, dock vacancy, gate exit, destination and delivery controls. Their authorisation and evidence requirements remain authoritative.
5. Monitor accepted quantity and the remaining fulfilment obligation. Search Deliveries by customer or consignment and navigate back to the order from either the board or journey.

The register is paginated at 20 orders. Selected dossiers load separately, so a link remains usable even when the order is outside the current register page. Load selection offers the latest 20 matching linked journeys; narrowing the search finds older matches. Read failures show Retry and do not masquerade as empty registers.

## Data and authority

`journeys.Consignment` retains organisation, origin facility, customer/order references, commodity, target quantity/unit, deadline, optional external reference, author, reason and replay key.

`journeys.ConsignmentAllocation` retains the exact delivery-plan version, stop, line reference and quantity. Both entities use the existing immutable `Retained` model. Writes require assigned site access, enabled routing/fleet modules and the tenant's `routes.create` permission. Reads require the existing tenant/site `routes.read` permission. Dispatch, Operations, Facility Manager and Admin are eligible authors; tenant configuration may restrict these permissions. Compliance and Executive can read without order-authoring controls.

Creation and allocation append audit records in the same transaction. Site locks and an order lock serialize allocation checks; uniqueness constraints reject duplicate plan lines and conflicting replay keys. Audit entries expose the consignment reference alongside movement references. No new production tenant is configured.

Allocating any line fixes that journey's delivery plan. The model and command service reject replacement plans thereafter, preserving the association between the order, quantity and eventual receipt. Existing unallocated plans can still be revised before release. Original idempotent command replays remain valid.

## Fulfilment semantics

| Value | Meaning |
| --- | --- |
| Allocated | Sum of retained plan-line allocations, including goods later returned |
| Accepted | Allocated quantity at stops whose authoritative outcome is `DELIVERY_ACCEPTED` |
| Still to allocate | Target minus allocated quantity |
| Outstanding delivery | Target minus accepted quantity |
| Authorised for return | Allocated quantity at rejected stops with an authorised return; not an accepted delivery |
| Fulfilment percentage | Accepted / target, rounded down to a whole percentage |
| Overdue | Deadline passed in the origin site's timezone and target not accepted in full |

Arrival, release, departure, rejected delivery and return receipt do not increase fulfilment. Each quantity uses decimal arithmetic and an exact unit; unit conversion is not inferred. Intermediate delivery acceptance counts only the allocation at that stop. Physical receipt remains a staff attestation backed by a retained evidence reference/fingerprint; evidence reconciliation, ERP acknowledgement and commercial closure remain separate.

## API

- `GET /api/consignments/?facility=…&page=1&q=…`: scoped searchable register, progress and authoring permission; no full load dossier per row.
- `POST /api/consignments/?facility=…`: create a retained customer consignment with a replay key.
- `GET /api/consignments/{id}/?facility=…`: selected order, allocations, trucks and accountable next actions.
- `POST /api/consignments/{id}/?facility=…`: allocate a current retained delivery-plan line using plan ID, stop index, reference, reason and replay key.

No public endpoint for these consignments is introduced. Existing authenticated journey commands remain the only movement controls.

## Boundaries

ERP/tracker adapters, customer notification delivery and external customer access are not configured by this change. It does not copy Morres' payment/accounting module or public shipment access. Existing notification and tracking mechanisms are not evidence of a connected customer integration.

Order correction revisions, allocation cancellation and replacement dispatches for returned quantity remain follow-up work. Allocations cannot currently be edited or freed; returned quantities remain reserved and outstanding. Operators must not count received returns as successful delivery or create duplicate allocations to disguise the shortfall.

No instrument, statutory threshold, monetary penalty or source of law is introduced or asserted to be verified.

## Verification

- 108 distinct backend checks passed across consignments, architecture/tenant configuration, regulatory controls, connected journeys, delivery execution, existing workspaces and audit-chain regression (87 in the wider run and 36 in the final focused run, with 15 overlapping cases).
- 101 existing frontend unit checks passed.
- Seven Chromium cases passed with synthetic intercepted APIs: order authoring/allocation, partial fulfilment, Executive read-only access, failed-read recovery, evidence renewal, existing delivery controls and offline recovery.
- Desktop and 390px mobile screenshots were inspected. The mobile viewport has no horizontal overflow.
- Production build passed. Lint retains the existing shared UI Fast Refresh warning.

Backend tests use an isolated test database. Browser writes use intercepted synthetic APIs. No production customer/order, trip, evidence, release or delivery was created or changed. Migration `journeys/0005_consignment_consignmentallocation_and_more.py` must be applied with the backend release before serving the new frontend. This change has not been deployed.
