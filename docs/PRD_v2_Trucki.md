# Trucki — Product Requirements Document (PRD) v2

**Product:** Trucki — African Logistics Operations Platform (yard compliance + fleet operations)
**Prepared by:** Tinotenda Brandon Duma | Founder & Lead Developer, RadBit Studios
**Version:** 2.0 | **Date:** October 2026
**Status:** Active build specification for Release 1.
**Supersedes:** `PRD_v1_BAK_Logistics_Operational_Intelligence_Layer.txt`, `bak-pwa-prd.md` (both retained as evidence), `spotterAI/docs/*` (stale US-HOS assessment material — discarded).

**Provenance labels used throughout:** `[PORT-FROM-BAK]` = requirement proven in the BAK build · `[PORT-FROM-TRUCKI]` = requirement proven in the Trucki build · `[NEW]` = not yet built · `[DROPPED]` = explicitly out of product.

**Evidence status of source systems (read this first):**
- BAK OpShield: **built + demonstrated** (demo environment live), **not bought** — pilot closed 2026-10-04 (`bak-pilot-closed` tag). No payment, no signed agreement; full IP retained by RadBit.
- Trucki/SpotterAI: **built**, deployed on free tiers, **zero external users**.
- Neither system has validated demand. This PRD is a specification, not evidence of a market.

---

## 1. Product vision & positioning

Trucki is one multi-tenant operations platform for African logistics operators, covering two halves of the same job:

1. **The yard** — a truck arrives, queues, gets a dock, is weighed, is checked against the law, and is released with tamper-evident proof.
2. **The fleet** — a load is booked, quoted, assigned to a driver and vehicle, tracked across the corridor, and closed out as paid.

Positioning: **operations + compliance software for SADC corridor operators**, mobile-first, offline-tolerant, priced against the cost of a single overload incident (USD $0.50/kg under S.I. 129/2015 → ~$945 average per incident). Not a telematics company, not an AI product. The intelligence is deterministic: rules, state machines, and an audit chain.

## 2. Market & problem statement

**Problem 1 — Regulatory exposure `[PORT-FROM-BAK]`:** S.I. 129/2015 and S.I. 159/2022 enforce USD $0.50 per excess kg; manual pre-departure checks fail under dispatch pressure. Average per-incident cost ≈ USD $945 (fee + re-weigh + clearance + storage + decanting). Seven prevented overloads repay a typical pilot.

**Problem 2 — Unmeasured yard dwell `[PORT-FROM-BAK]`:** spreadsheets, radios and messaging apps leave facility managers without dwell times, dock utilisation, or surge visibility. Beitbridge corridor backlogs produce unpredictable arrival waves.

**Problem 3 — Fragmented fleet visibility `[PORT-FROM-TRUCKI]`:** small-to-mid fleet owners run trips over spreadsheets, phone calls and WhatsApp threads: no single status of a trip, no cost-vs-revenue record, no driver location, no border-crossing state.

**Problem 4 — Manual compliance evidence `[PORT-FROM-BAK]`:** when a regulator or client disputes a load or a release, operators have no tamper-evident record of who checked what, when, on whose authority.

**Target customers (in order of pursuit):** freight forwarders & transit depot operators · intercity bus/coach operators · haulage contractors · horticulture/cold-chain exporters · construction & materials logistics. Geography: Zimbabwe + SADC corridors (Beitbridge, Forbes, Chirundu).

## 3. Personas & role model

### 3.1 Yard/facility family `[PORT-FROM-BAK]`

| Role (code) | Responsibilities | Key pain |
| :--- | :--- | :--- |
| `DISPATCH_SUPERVISOR` | Gate entry/exit, weighbridge capture, release | Manual typing errors, bad Wi-Fi |
| `OPERATIONS_SUPERVISOR` | Docks, quarantine, overrides, alerts | Opaque yard capacity |
| `FACILITY_MANAGER` | Capacity, equipment, escalation | No dwell/utilisation numbers |
| `COMPLIANCE_OFFICER` | Audit trail, checklist config | No defensible evidence |
| `EXECUTIVE` | SLA reports, ROI, read-only | Client disputes, fine exposure |
| `ADMIN` | Tenant setup, users, seeding | — |

### 3.2 Fleet family `[PORT-FROM-TRUCKI]`

| Role | Responsibilities | Key pain |
| :--- | :--- | :--- |
| Fleet owner / admin (`is_staff`) | Vehicles, drivers, trips, dispatch, costs | No single trip status |
| Dispatcher | Assign driver+vehicle, monitor live map | Phone-tag coordination |
| Driver (app or **WhatsApp**) | Accept/decline, status updates, position, SOS | App fatigue; wants WhatsApp |
| Customer (unauthenticated) | Book a load, track by reference | "Where is my truck?" calls |

### 3.3 Platform `[NEW]`
| Role | Responsibilities |
| :--- | :--- |
| RadBit platform admin | Tenant provisioning, health, billing state (billing itself is R3) |

Every tenant sees only its own org + facilities. Roles map to server-enforced permissions (see SAD §Auth); client-side gates are advisory only.

## 4. Release plan

| Release | Scope | Gate to start next release |
| :--- | :--- | :--- |
| **R1 — Compliance wedge** (build now) | Tenancy, auth/roles, Module A (queue/docks), Module B (compliance/audit), Module F notifications (quarantine leg), Module G reports, admin seed/reset | 10 qualified demos held + 1 paid pilot signal |
| **R2 — Fleet** | Module C (vehicles/drivers/trips), Module D (driver app + WhatsApp bot), live map, cost engine | First fleet customer or first yard customer asking for trips |
| **R3 — Commerce** | Module E (public booking + tracking), payments, billing plans, WMS/ERP bridge | Revenue from R1/R2 |

Rule: nothing in a later release may delay R1. Marketing may *describe* R2/R3 as roadmap — never as shipped.

## 5. Functional requirements — Release 1

### 5.1 Module A — Yard Capacity Command Centre `[PORT-FROM-BAK]`

- **FR-A1 Live queue management:** register vehicle entry (reg, timestamps, driver), live status board, exit stamps. Offline-capable. *(BAK: live, `QueueDashboard.tsx`.)*
- **FR-A2 Dock allocation:** tap available dock → assign oldest `QUEUED` vehicle, transactional, online-only. Auto/surge algorithm deferred to R1.1. *(BAK: partial.)*
- **FR-A3 Surge visibility:** live counts + status board; threshold auto-queueing deferred.
- **FR-A4 Turnaround analytics:** dwell/wait/utilisation stats from entry/exit timestamps, CSV export. *(BAK: live.)*

**Queue lifecycle (server-enforced):** `QUEUED → ASSIGNED → AT_DOCK → (compliance) → QUARANTINED | COMPLETED → RELEASED`, with `PENDING_OVERRIDE → OVERRIDE_APPROVED` branch.

### 5.2 Module B — Smart Compliance Gatekeeper `[PORT-FROM-BAK]`

- **FR-B1 Pre-departure checklist:** config-driven, mandatory gating, per-vehicle-type S.I. selector, photo/note support. *(BAK: live.)*
- **FR-B2 Weight rule engine:** validate GVM + axle loads against S.I. 129/2015 tables (route × vehicle type); configurable limits per tenant. **Enforcement server-side.** *(BAK: live in client, ported to server in R1.)*
- **FR-B3 Quarantine workflow:** FAIL → vehicle `QUARANTINED`, release blocked, deterministic `quar-<id>` critical alert; override request → approval by a **different** user (secondary-approver rule). *(BAK: live.)*
- **FR-B4 Immutable audit trail:** SHA-256 hash chain (`previous_hash + payload + salt`), append-only, per-tenant serialization, salt fails closed, export + verify. *(BAK: built; live-path verification required before any "tamper-proof" claim — see Risks.)*
- **FR-B5 Weighbridge capture:** Web Serial (9600-8-N-1) parse into total weight; axle split manual; field-test against Avery/Rice Lake outstanding. *(BAK: built, untested in field.)*

### 5.3 Module C — Fleet & Trip Operations `[PORT-FROM-TRUCKI]` *(R2)*

- **FR-C1 Master data:** organisations, vehicles (plate, fuel rate, service interval, odometer, status), drivers (licence, rates, status), commodities with rate cards.
- **FR-C2 Trip lifecycle:** `inquiry → quoted → confirmed → assigned → dispatched → at_border → in_transit → delivered → paid` (+ `cancelled`), invalid transitions rejected server-side. *(Trucki: built, `permissions.py:42-59`.)*
- **FR-C3 Cost & revenue:** estimated vs actual (fuel, driver pay, border fees, tolls) + revenue per trip; fuel records; margin report.
- **FR-C4 Dispatch:** assign driver + vehicle, priority, load weight/commodity.
- **FR-C5 Live map & tracking:** last position per active trip (manual/GPS/WhatsApp sources).
- **FR-C6 Truck recommendation:** cargo weight → vehicle suggestion (rule-based).

### 5.4 Module D — Driver experience `[PORT-FROM-TRUCKI]` *(R2)*

- **FR-D1 Driver app view:** active trip card, status updates, position share, SOS.
- **FR-D2 WhatsApp driver bot:** `ACCEPT / REJECT / STATUS / SOS / WHERE / HELP / SUMMARY` + location messages → trip updates. No app install required.
- **FR-D3 Offline driver sync:** local queue of status/position updates replayed on reconnect.

### 5.5 Module E — Booking & customer tracking `[PORT-FROM-TRUCKI]` *(R3)*

- Public booking wizard by service type, truck recommendation, booking reference, customer token–authenticated status page, WhatsApp booking confirmation.

### 5.6 Module F — Notifications & escalation `[PORT-FROM-BAK] + [PORT-FROM-TRUCKI]`

- **FR-F1 Quarantine/critical alerts (R1):** WhatsApp (template) primary → SMS fallback → web push; role-gated acknowledgement.
- **FR-F2 Escalation timers (R1, log-only):** 10 min → facility manager, 30 min → executive; delivery channels enabled when credentials configured.
- **FR-F3 Trip status notifications (R2):** WhatsApp/SMS to customer and driver on status change.

### 5.7 Module G — Audit, reports & analytics `[PORT-FROM-BAK] + [PORT-FROM-TRUCKI]`

- **FR-G1 Audit viewer (R1):** read-only, severity/time ordered, CSV export, chain verification action. *(BAK: built, export/verify UI pending.)*
- **FR-G2 Operations reports (R1):** dwell, wait, utilisation, compliance pass/fail, fines-intercepted ROI line.
- **FR-G3 Fleet dashboard (R2):** metrics, top routes, trip pipeline (Trucki: built).

### 5.8 Module H — Platform, tenancy & admin `[NEW]`

- **FR-H1 Tenant provisioning:** sign-up → tenant + admin facility + admin user; later: invite users with roles.
- **FR-H2 Multi-tenancy:** every record scoped to tenant (and facility within tenant); cross-tenant read/write denied at the API and in tests.
- **FR-H3 Yard seed & demo reset:** one action creates a realistic shift (vehicles in every state, docks, alerts, audit entries) for demos; resettable.
- **FR-H4 PIN login:** staff ID + PIN on shared tablets (no password typing in the yard), provisioned by admin. *(BAK: built — `BAK-<staff-id>` scheme to be renamed `TRK-…`.)*
- **FR-H5 Practice/training mode:** synthetic sessions that never touch live data. *(BAK: built.)*

## 6. Non-functional requirements

| # | Requirement | Notes |
| :--- | :--- | :--- |
| NFR-1 | **Offline resilience** | Queue create + compliance submit must work with no network and replay safely on reconnect (idempotency keys, server timestamps, last-write-wins). Dock assignment remains online-only by design. `[PORT-FROM-BAK]` |
| NFR-2 | **Mobile-first, low-end Android** | 10-inch rugged tablets + phones; touch targets, shape+text status (not colour alone); initial JS < 200KB gzip target where achievable. `[PORT-FROM-BAK]` |
| NFR-3 | **Server-authoritative security** | RBAC + tenant isolation enforced server-side; client gates advisory; negative tests required for every permission rule. `[NEW — replaces Firestore rules]` |
| NFR-4 | **Audit integrity** | Append-only chain, server-owned hash, fail-closed salt, per-tenant serialization; verify action available to compliance roles. `[PORT-FROM-BAK]` |
| NFR-5 | **Performance** | p95 reads < 500ms at 50 concurrent users (k6 gate before any paid deployment). `[PORT-FROM-BAK]` |
| NFR-6 | **Data residency & deletion** | Tenant data export (CSV) + tenant deletion workflow before first paying customer. `[NEW]` |
| NFR-7 | **Localisation** | English now; Shona + Ndebele in R2 (identified in BAK PRD as Phase 2). `[NEW]` |

## 7. Integrations

| Integration | Release | Status |
| :--- | :--- | :--- |
| Weighbridge (Web Serial) | R1 | Built, field-test pending `[PORT-FROM-BAK]` |
| WhatsApp (Twilio inbound for drivers; outbound alerts) | R1 (alerts) / R2 (bot) | Built on both sides; channel unification in SAD |
| SMS fallback (Africa's Talking/Twilio) | R1 optional | Built `[PORT-FROM-BAK]` |
| Web push (VAPID) | R1 optional | Built `[PORT-FROM-BAK]` |
| Geocoding (Nominatim/Photon) + routing (OSRM) | R2 | Built `[PORT-FROM-TRUCKI]` |
| WMS/ERP bridge (manifest/confirm, SAP/Syspro profiles) | R3 | Code-complete, never UAT'd `[PORT-FROM-BAK]` |
| Payments | R3 | `[NEW]` — none exists; `paid` is only a status today |

## 8. Success metrics & evidence ladder

| Metric | Target | Meaning |
| :--- | :--- | :--- |
| Qualified demos (R1) | 10 in first 30 days | Named operator + ops decision-maker + live walkthrough + logged signal |
| Paid pilot | 1 first paying tenant | Moves evidence from *demonstrated* → *validated* |
| Overload incidents prevented | ≥ 7 per paying yard | Repays pilot — the core ROI claim |
| Offline field test | 1 yard, real tablet | Closes BAK's oldest open NFR |
| Fleet users (R2) | 1 active fleet ≥ 4 weeks | Gate for R3 |

Evidence words are earned, never asserted: built → demonstrated → deployed → used → paid → validated.

## 9. Explicit non-goals `[DROPPED]`

- **HOS / FMCSA / daily-log engine and US interstate routing** — Trucki's assessment heritage; no African market value. Code removed in R2 cleanup.
- **"AI" features** — the brand name is historical; no LLM is used or promised.
- **Telematics/hardware** (GPS trackers, RFID, ANPR) — architecture leaves room; nothing built.
- **Electron desktop wrapper** — deferred indefinitely; web PWA only.
- **Real-time streaming map** — polling is acceptable in R1/R2.

## 10. Assumptions, risks, dependencies

| # | Item | Type | Mitigation |
| :--- | :--- | :--- | :--- |
| R1 | Demand unproven — BAK was *not bought* | **Highest risk** | 10-demo metric; code freezes at demo day 15 if <3 booked; build never substitutes for selling |
| R2 | Cross-tenant data leak | Product-killing | Server-side scoping + mandatory negative tests + two-tenant manual gate |
| R3 | Audit chain live path unverified after Firebase removal | Claim integrity | Proven by automated verify test before any compliance demo |
| R4 | Scope creep into R2/R3 during R1 | Schedule | Section 4 rule; PRD changes require version bump |
| R5 | Weighbridge field-test never done | Feature claim | Demo uses manual entry until tested; never claim otherwise |
| R6 | WhatsApp template approval lead time | Notifications | Alerts ship with push+SMS fallback; WhatsApp added when approved |

## 11. Open questions (must answer before R2 kickoff)

1. Which single customer segment gets the R2 build priority — haulage, bus/coach, or cold chain?
2. Twilio vs Meta Cloud API as the single WhatsApp channel (both exist today, one per system)?
3. Pricing model (per yard / per vehicle / per trip) — decide with R1 demo feedback, not before.
