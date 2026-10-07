# Trucki alongside an existing ERP: initial research

Research date: 7 October 2026. Status: discovery hypothesis, not an approved implementation roadmap.

## Finding

Attribution correction: Tariro describes Trinitas. BAK remains the first configured reference tenant; its incumbent-system capabilities are not established by this discussion. No Trinitas configuration is authorised by this research.

Tariro's feedback changes the commercial question. Trinitas already has an internal company-wide system with logistics, according to the user. Its product, version, customisations, enabled modules, interfaces and operational shortcomings are not yet known. No capability below should be described as missing from Trinitas's system until demonstrated.

Further stakeholder evidence supplied during research: the user reports that Tariro says the incumbent covers HR, accounting, driver-specific analytics, truck-specific analytics, route analytics, fuel consumption and profit/loss calculations. Treat this as reported existing scope, not independently tested depth or accuracy. The ERP name remains unknown. These areas are presumptive duplication and should not anchor Trucki's Trinitas sales proposition. No operational pain or missing capability was identified in that follow-up.

| Reported incumbent scope | Implication for Trinitas discovery |
| --- | --- |
| HR and accounting | Retain incumbent ownership; do not propose a replacement |
| Driver/truck analytics | Do not sell another driver or vehicle dashboard; determine source data ownership |
| Route analytics | Do not presume route visibility is missing; distinguish analytics from actual truck-route restrictions only if this matters operationally |
| Fuel consumption | Reuse existing evidence where authorised; do not introduce parallel fuel capture without a demonstrated need |
| Profit/loss calculations | Avoid a competing financial calculation; any pilot benefit must reconcile with their financial definitions |

The next discussion should ask what still happens outside this system, what recent exception was difficult to resolve, and which outcome the incumbent cannot deliver economically. A demonstrable gap is required before choosing departure assurance, yard execution or evidence reconciliation as the wedge.

Trucki should be assessed against configuring or extending that incumbent system, buying an existing specialist module, and improving the operating process. A second application is justified only if it closes a measurable gap at an acceptable integration and operating cost. A narrow product can be valuable; adding breadth without this evidence is not the remedy for perceived thinness.

## What the market already covers

These are documented product capabilities, not claims about Trinitas's installation, license or configured workflows. Vendor documentation establishes availability, not independent proof of outcomes or current procurement pricing.

| Product/category | Documented capability | Implication for Trucki |
| --- | --- | --- |
| SAP Transportation Management | ERP orders/deliveries, planning, carrier selection, execution and settlement integration | Generic booking/dispatch/routing is substantial overlap |
| Dynamics 365 Supply Chain Management | Inbound/outbound transportation, order/shipment-based planning and routing/rate selection | A transport screen or dashboard is insufficient differentiation |
| SAP Yard Logistics | Check-in/check-out, planning, execution, yard monitoring and billing | Queue/dock visibility cannot be assumed to be an ERP gap |
| Odoo dispatch management | Shipment planning/building and in-house delivery vehicle capacity | Overlap exists beyond enterprise-scale suites |
| Soloplan CarLo | Order management, transport planning, calculation/reporting and interfaces to existing systems | A broad TMS is another established alternative |
| MiX Integrate | Telematics integration through documented APIs | Ingest existing movement evidence where available rather than creating a parallel tracking estate |
| Geotab compliance | Vehicle inspection reporting and compliance products | Mobile checks and inspection records already have specialist competitors |
| Loadtech software | Weight-data software and integration with weighing equipment | Weighing capture alone is also an established product category |

Sources:

- [SAP TM capabilities and ERP integration](https://help.sap.com/docs/SAP_TRANSPORTATION_MANAGEMENT/54cf405c9d9e4c96bf091967ea29d6a7/74e81756c882bf45e10000000a4450e5.html) (documentation version 9.6 FPS02; not an assertion of Trinitas's version).
- [Microsoft transportation management overview](https://learn.microsoft.com/en-us/dynamics365/supply-chain/transportation/transportation-management-overview).
- [SAP Yard Logistics](https://help.sap.com/docs/SAP_YARD_LOGISTICS_FOR_SAP_S_4HANA/6b743a3f2b1a4cf3a2b8941d22a4b5c2/9b69e7557c7ae263e10000000a44538d-64.html).
- [Odoo dispatch management](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/setup_configuration/dispatch.html) (versioned documentation).
- [Soloplan CarLo and interfaces](https://www.soloplan.com/).
- [MiX Integrate API documentation](https://integrate.om.mixtelematics.com/CustomContent/api-docs-1.html). Access, region, licensing and provider approval still require discovery.
- [Geotab compliance products](https://www.geotab.com/fleet-management-solutions/compliance/). This is competitive capability evidence, not adoption of another jurisdiction's rules.
- [Loadtech software](https://www.loadtech.co.za/software-main/).

## Assessment of the current repository

The following assessment uses `TENANT_RELEASE_IMPLEMENTATION.md`, `PRD_v2_Trucki.md`, the tenant adapter registry and scoped searches of the current backend. It is an initial fit assessment, not an exhaustive new code audit.

| Area | Current evidence | What is still unproven or missing |
| --- | --- | --- |
| Tenant configuration | Versioned modules, policies, workflows, sites, permissions and explicit activation | Whether these match the customer's organisational responsibilities and change process |
| Inspection and release | Evidence snapshots, repeat inspection attempts, independent approvals, versioned evaluation and release gates | Real operational evidence quality; whether a decision controls the actual departure process |
| Regulatory provenance | Platform source/ROU/pack revision and review model | Reviewed applicable legal content; legal ownership and update service; no new verified law is claimed |
| Yard and reporting | Queue/dock flows, dwell reporting, audit and synthetic modelling | Completeness of real timestamps, adoption, baseline and measurable operational improvement |
| Routing | Generic road preview, maps and context | Truck-specific route legality and live provider integration must not be inferred from a map |
| Enterprise integration | Installed adapter types are notifications and road routing | No implemented ERP-specific order/master-data/status connector was identified; no demonstrated ERP reconciliation contract |
| Commercial validation | Demonstrated workflows and tests | Trinitas's buying criteria, sponsor, budget, incumbent comparison and paid scope |

The old PRD puts the WMS/ERP bridge in R3. For a customer who already operates an ERP, an integration feasibility spike belongs before a credible operational pilot. The PRD also contains historical unverified monetary/legal positioning; that wording must not be reused as research evidence or a savings baseline. This research does not amend statutory rules or the approved tenant architecture.

## Candidate value propositions to test

These are hypotheses, with explicit rejection conditions.

| Hypothesis | Evidence required | Reject or defer if |
| --- | --- | --- |
| Decision and evidence layer for departure | A real load whose source records, vehicle configuration, route context and independent approval cannot currently be reconstructed efficiently | Incumbent already delivers this adequately, or Trucki cannot influence the real release process |
| Exception resolution across systems | A recent held/changed load with manual handoffs, unclear ownership and measurable delay | Most delays are unrelated to software or current ERP configuration solves them cheaply |
| Yard execution connected to ERP demand | ERP dispatch references plus reliable arrival/dock/weigh/release timestamps; a measurable visibility or delay gap | A deployed yard module already provides equivalent service at lower total cost |
| Evidence reconciliation across ERP, weighing and telematics | Actual mismatches, duplicate entry or difficult dispute reconstruction, with a common load identifier available | Interfaces/data rights are unavailable, or the mismatch has no meaningful business cost |

The strongest initial hypothesis is an ERP-connected departure assurance and exception workflow. It is not yet validated, exclusive, or necessarily the right product. Source/version provenance is a useful capability; it becomes a buying reason only when it improves an actual operational outcome.

## Proposed ownership boundary, subject to discovery

Keep financial accounting, stock valuation, commercial order ownership and invoicing in their existing systems. Agree which system owns driver/vehicle/customer master data before importing anything. Trucki would retain its own operational observations, inspections, evaluation snapshots, exception decisions and audit trail. Raw measurement and location evidence remain attributable to their originating equipment/providers.

An illustrative flow is: ERP dispatch/order reference -> imported load context -> weighing/inspection evidence -> readiness evaluation -> recorded hold or authorised operational release -> acknowledged status/evidence reference back to ERP. This is a proposed integration contract, not shipped functionality. ERP commercial approval must not automatically become a regulatory clearance, and a Trucki status must not silently change inventory or financial records.

An ERP reference changing quantity, vehicle, route or cancellation after inspection must trigger explicit impact assessment and, where decision-relevant, fresh evaluation. The operator must see sync freshness and outstanding failures. A release record should never imply the ERP acknowledged a message until an acknowledgement has been recorded.

Minimum integration design: tenant-scoped external identity mapping; explicit system of record for each field; authenticated adapter with narrowly scoped rights; schema/version validation; idempotent commands/events; retry and dead-letter handling; acknowledgements; cancellation/change semantics; periodic reconciliation; retention and access boundaries. Begin with approved sample export/import in a sandbox if APIs are unavailable. Do not promise a production API connector without confirming access and licensing.

## Discovery with Tariro and internal IT

Request one 60-90 minute walkthrough with dispatch, compliance/yard operations and the ERP owner. Ask for redacted examples rather than broad feature wish lists. Obtain authorised access only; no production credentials or personal driver documents are required for the first discussion.

1. Identify the ERP/internal application's name, vendor or development team, version, hosting and support owner. Establish whether logistics is a custom module, external TMS integration or standard feature.
2. Follow one ordinary dispatch from order creation to loading, departure, delivery evidence and financial close. Record every system, identifier, handoff and duplicate entry.
3. Repeat with one changed or held load. Identify who can stop departure, who approves an exception, and how the physical gate gets that instruction.
4. Show the last relevant dispute/incident and how its evidence was reconstructed. Establish frequency and consequence from actual records; do not assume fines or savings.
5. Inventory weighing, telematics, document, messaging and identity systems. Confirm exports/APIs/webhooks, sandbox, vendor rights, fees and change restrictions.
6. Identify an accountable operational sponsor, IT owner and budget owner. Ask what measurable result would justify adopting another tool rather than extending the ERP.

Outputs: current-state process map; system/field ownership matrix; demonstrated-gap register; sample data and interface constraints; incumbent-extension estimate; proposed pilot acceptance and commercial scope. Keep unconfirmed statements labelled hypotheses.

## Pilot decision and measurements

A reasonable pilot candidate is one site, one agreed dispatch flow and a small set of normal/change/exception cases. The cohort size and duration must follow throughput and stakeholder agreement rather than an invented target.

Measure baseline and pilot using the same definitions: duplicate-entry time per load; proportion of departures with complete agreed evidence; time from exception creation to resolution; time to retrieve an agreed evidence package; ERP/Trucki status mismatches and their age; and dispatch-to-departure or yard dwell only where reliable timestamps exist. Assign an owner, denominator, observation window and exclusion rules to each measure. Synthetic modelling proves software paths, not customer ROI or legal compliance.

Proceed only when there is a demonstrated unresolved gap, an owner with buying authority, usable data/integration access and agreed measurable acceptance. Prefer an incumbent extension or process improvement when it is the better answer. Pause broad new feature development if these conditions are absent. Preserve validated Trucki workflows and the tenant boundary throughout; do not create Trinitas or another production tenant as part of research.

## Recommended next work

First establish the actual installed system and walk the two real cases. Then produce a side-by-side fit/gap assessment of incumbent configuration, incumbent extension, existing specialist software and Trucki. If Trucki remains justified, revise the PRD around that evidence and run a limited integration spike before committing to a larger build. No application functionality or production configuration was changed for this research.
