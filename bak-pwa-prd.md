# Product Requirements Document (PRD)

**Project Title:** RadBit Local-First Operational Intelligence PWA (OpShield)  
**Target Enterprise:** BAK Logistics (Harare, Zimbabwe)  
**Prepared For:** Takudzwa Mandiwanza | Business Development Manager, BAK Logistics  
**Prepared By:** Tinotenda Brandon Duma | Founder & Lead Developer, RadBit Studios  
**Document Version:** 1.1 (Aligned with as-built MVP)
**Date:** September 2026
**Status:** §4–§6 annotated with [LIVE] / [PARTIAL] / [DEFERRED] per `bak-logistics-app/` audit. See SAD v1.1 §7 gap register.

---

## 1. Executive Summary & Problem Statement

### 1.1 Context & Operational Footprint
BAK Logistics operates as a premier logistical anchor in Southern Africa, managing over **72,000m² of warehousing space under roof** in Harare and a **6,000 TEU container depot** that functions as a fully operational multimodal dry port [54]. Acting as a primary transit hub connecting South Africa, Mozambique, Zambia, Malawi, and the Democratic Republic of Congo (DRC), BAK's commercial yield is governed strictly by **asset velocity** (maximizing load cycles per asset per day) [2, 54].

### 1.2 The Problem
As freight volumes scale, invisible operational friction compounds across BAK's Harare and Bulawayo complexes [1, 3, 54]:
1. **Unmeasured Yard Dwell Times & Congestion:** Facility managers rely on fragmented communications (spreadsheets, walkie-talkies, messaging apps), creating sub-optimal dock scheduling, unmeasured vehicle wait times, and artificial yard bottlenecks [3, 4].
2. **SADC Corridor Backlogs:** External regional choke points, such as the **Beitbridge Port of Entry** (where commercial truck queues frequently stretch up to **20 kilometres** due to slow customs processing), cause unpredictable "surge arrivals" at BAK's Harare gates [16].
3. **Severe Regulatory Exposure (Axle Overloading):** Under **Statutory Instrument 129 of 2015** and **S.I. 159 of 2022**, the Zimbabwe National Road Administration (ZINARA) and the Vehicle Inspectorate Department (VID) strictly enforce an administrative overload fee of **USD $0.50 per excess kilogram** [73, 85, 102]. Manual pre-departure checks fail under high dispatch pressure, exposing BAK and its clients to average per-incident costs of **USD $945.00+** (comprising a $750 overload fee for a 1.5t mismatch, $20 re-weighing fee, $25 RT16 prohibition clearance, $20/day depot storage fee, and ~$150 in roadside cargo decanting/offloading costs) [86, 101, 102].
4. **Perishable Cold-Chain Risk:** In Zimbabwe's booming **USD $50M+ horticultural export sector** (e.g., blueberries), transit delays exacerbate biological cargo decay under the **$Q_{10}$ thermodynamic law** (doubling degradation per 10°C temperature rise) while burning expensive reefer generator fuel (30–35% of operating costs) [23].

### 1.3 Proposed Solution
Deploy the **RadBit Local-First Operational Intelligence PWA**, a non-disruptive, offline-capable software overlay operating on **3x ruggedized Android tablets** (~USD $1,200 hardware) alongside a **USD $5,000 software pilot** [1, 5, 10, 13].

---

## 2. Product Goals & Business Objectives

* **Zero-Defect Dispatch Compliance:** Achieve a 100% pre-departure validation rate on outgoing haulage dispatches prior to yard exit, eliminating downstream ZINARA overload penalties [2, 3, 7].
* **Yard Turnaround Acceleration:** Systematically track vehicle dwell times and dock allocations, serving as a "surge buffer" to absorb and clear waves of trucks arriving from delayed SADC corridors [6, 16].
* **Asymmetric Financial ROI:** Recover the full **USD $6,200 all-in pilot cost** upon preventing just **7 overloaded dispatches** at the yard gate [73, 85, 102].
* **Zero IT Downtime:** Launch as a standalone local-first overlay that requires zero modifications to BAK's legacy core WMS/ERP systems during initial rollout [1, 5].

---

## 3. User Personas & Target Roles

| Persona / Role | Primary Responsibilities | Key Pain Points | System Interaction |
| :--- | :--- | :--- | :--- |
| **Shift Gatekeeper** | Vehicle entry/exit logging, seal verification, weighbridge data capture [7, 14]. | High pressure, manual typing errors, bad Wi-Fi in yard [4]. | Mobile Tablet PWA (Module B): Rapid digital checklists, automated weight validation [7]. [LIVE as `DISPATCH_SUPERVISOR` — manual weight entry, demo + live Firestore modes.] |
| **Yard Operations Supervisor** | Dock scheduling, equipment allocation, exception handling [4, 6]. | Opaque yard capacity, congested loading bays, uncoordinated drivers [3, 4]. | Tablet/Desktop (Modules A & B): Live queue management, quarantine bay dispatch [6, 14]. [LIVE as `OPERATIONS_SUPERVISOR` + `FACILITY_MANAGER`: transactional dock assign, quarantine + CRITICAL alert.] |
| **Business Development Manager (Takudzwa Mandiwanza)** | Commercial strategy, client SLAs, margin protection [1]. | Client disputes over stranded cargo, ZINARA fines, lost asset velocity [1, 2]. | Executive Control Tower (Module A): Exportable SLA analytics, turnaround baselines [6]. [PARTIAL — `EXECUTIVE` role + audit/alert reads live; `/reports` export is Placeholder → P1.] |
| **System roles (as-built)** | RBAC enforcement | — | `ADMIN` (seed + user claims bootstrap), `COMPLIANCE_OFFICER` (audit read). Login = Firebase email/password + custom claims `{role, facilities}`; demo role-picker when env unset. |

---

## 4. Functional Requirements

### 4.1 Module A: Capacity Command Centre (Desktop / Control Tower)
* **FR-A1 (Live Queue Management):** Digital entry/exit registration tracking timestamped driver arrivals, vehicle registration numbers, and gate wait times [6]. [LIVE — `QueueDashboard.tsx`: Zod-validated register, Firestore `queue` subscription, offline `queue.create` queueing, demo seeds.]
* **FR-A2 (Algorithmic Dock Allocation):** Dynamic assignment of arriving haulage assets to specific loading/unloading bays within BAK's 72,000m² complex [6, 54]. [PARTIAL — `DockBoard.tsx`: tap-to-assign oldest QUEUED → AVAILABLE dock via Firestore transaction; online-only; no auto/surge algorithm yet.]
* **FR-A3 (Surge Arrival Stabilization):** Real-time capacity monitoring to queue and absorb sudden clusters of trucks arriving from SADC border backlogs [6, 16]. [PARTIAL — live counts + status board; no threshold auto-queueing or predictive monitoring.]
* **FR-A4 (Turnaround Analytics):** Automated, exportable reporting detailing average dwell times, peak congestion windows, and handling throughput [6]. [LIVE P1-2 — `Reports.tsx` + `computeTurnaroundStats`/`queueToCsv` + `releaseVehicleLive` exit stamps; Phase 6 adds surge banner, fines-intercepted ROI and 14d heatmap via sync-service API.]

### 4.2 Module B: Smart Compliance Gatekeeper (Mobile / Tablet)
* **FR-B1 (Mobile Pre-Departure Clearances):** Form-factor optimized digital checklists for supervisors conducting side-of-vehicle checks [7]. [LIVE P1-3 — config-driven checklist with mandatory gating + vehicle-type S.I. selector.]
* **FR-B2 (Automated Weight Rule Engine):** Configurable validation logic evaluating gross vehicle mass (GVM) and individual axle loads against legal thresholds under **S.I. 129 of 2015** (USD $0.50/kg threshold) [7, 73, 85]. [LIVE — `validateLoad()` + `canTransition()`, Vitest-covered; limits from `complianceConfig/default`; route/vehicle-type S.I. tables still hardcoded.]
* **FR-B3 (Automated Quarantine Workflow):** Automatic flagging and digital gate-block for non-compliant dispatches, auto-generating a quarantine ticket and rerouting the vehicle to a dedicated yard bay for physical load rebalancing [14]. [LIVE core — FAIL → `QUARANTINED` + deterministic `quar-{id}` CRITICAL alert (client + Function set-merge idempotent); override request/approve UI live P1-3 with secondary-approver gate.]
* **FR-B4 (Immutable Audit Trail):** Cryptographically secure digital logging of supervisor IDs, weighbridge tickets, seal numbers, and timestamped clearances [10]. [LIVE interim — SHA-256 chain client + Functions (`audit.ts`, `live.ts:89`); double-write while `CLIENT_AUDIT_ENABLED=true`; salt placeholder; export/verify UI deferred → P0.]

### 4.3 Phase 1 Physical Integration
* **FR-INT1 (Weighbridge Serial/IP Feed):** Direct RS232, USB, or TCP/IP interface connecting physical weighbridge scale indicators directly to the PWA tablet, automatically capturing scale weights and eliminating human typing errors [14]. [LIVE P1-1 — Web Serial 9600-8-N-1 + `parseWeighbridgeLine` stable capture into Total; axle-split still manual; field-test against Avery/Rice Lake pending.]

---

## 5. Non-Functional Requirements (NFRs)

* **NFR-1 (Performance & Latency):** Cold-start application launch in under 100ms; local UI mutations rendered in under 16ms using client-side IndexedDB persistence [77, 83]. [AS-BUILT: localStorage queue + Firestore SDK; IndexedDB/Dexie deferred → P0. Measure on rugged tablet before claiming.]
* **NFR-2 (Offline Resilience):** 100% feature availability during cellular or Wi-Fi outages across BAK's yards via Workbox service worker precaching and background synchronization queues [26, 77, 80]. [PARTIAL: queue/compliance queue offline; dock assign blocked offline by design (transactional); Workbox runtime caching missing → P0.]
* **NFR-3 (Security & Cryptography):** Data in transit encrypted via TLS 1.3; data at rest encrypted via AES-256; strict Role-Based Access Control (RBAC) [10]. [LIVE via Firebase + `firestore.rules` custom-claims gate; audit hash chain live with placeholder salt → rotate in P0.]
* **NFR-4 (Compatibility):** Optimized for Chromium-based browsers running on standard ruggedized Android tablets (10-inch display, standalone mode) [26, 80]. [LIVE — PWA `standalone`, touch targets, shape+text status (not color-only); field-test on Beitbridge-yard devices pending.]

---

## 6. Implementation Milestones (5-Week Agile Pilot)

* **Week 1 (Alignment & Scoping):** Finalize compliance parameters, user roles, S.I. 129 rules, and yard workflow mapping [9]. [DONE — roles expanded to 6 with custom claims; S.I. tables still to encode per route/vehicle-type.]
* **Weeks 2–3 (Engineering Sprint):** Build React 18 frontend, Dexie.js offline schema, Workbox service worker, and weight rule engine [9, 79, 81]. [AS-BUILT: React 19 + Vite 8 + Tailwind 4 + Firebase/Firestore + Zod engine + localStorage queue + Functions triggers + `openapi.yaml`. Dexie + Workbox runtime + weighbridge deferred — see Phase Plan below.]
* **Week 4 (Validation & Onboarding):** UAT, weighbridge serial integration testing, and 14-day parallel ground-staff onboarding [9]. [PENDING — weighbridge moved to P1; UAT entry criteria = P0 exit.]
* **Week 5 (Live Handover & Transition):** Go-live, active shift monitoring, and post-pilot ERP/WMS API mapping [9]. [PENDING — requires P0 cutover (Functions-only audit, salt rotation, staging deploy).]

### 6.1 Phase Plan — Fixes to Close Gaps (post-alignment)

**P0 — Pilot-blocking (Week 4 entry criteria):**
1. Dexie migration: replace `src/lib/offline/db.ts` localStorage with `OperationalLocalDB` (SAD §3 schema); keep action types + idempotency IDs; extend Vitest (`db.test.ts`) to IndexedDB; acceptance = offline queue survives 100+ actions, reload-safe.
2. Workbox runtime + Firestore persistence: add `runtimeCaching NetworkFirst /api/` equivalent + `enableIndexedDbPersistence`; acceptance = cold start offline renders shell + queued actions replay.
3. Audit cutover: deploy Functions to `radbit-bak-staging`, set `CLIENT_AUDIT_ENABLED=false`, rotate `AUDIT_SALT` env, verify `verifyChain()` on staging export; acceptance = single audit entry per event, chain verifies.
4. RBAC hardening: enforce `facilities` claim check on all writes (already in rules — add negative tests), remove demo picker from prod build; acceptance = rules unit tests 100% paths.

**P1 — Pilot-complete (Week 5 go-live):**
5. FR-INT1 weighbridge: Web Serial ASCII parser + auto-populate `ComplianceCheck` + fallback manual; acceptance = 20 consecutive reads zero typing, error-injection test.
6. FR-A4 reports: dwell/wait/utilization from `entryTimestamp/exitTimestamp`, CSV export, 14-day baseline view replacing `Placeholder.tsx`; acceptance = Takudzwa can export SLA week in <30s.
7. FR-B1 checklist UI: render `requiredChecklistItems` with photo/note per Tech Spec §5.1, mandatory gating; S.I. axle tables per route/vehicle-type in `complianceConfig`.
8. Override workflow UI: `PENDING_OVERRIDE → OVERRIDE_APPROVED` with secondary-approver rule (different user), wired to `openapi.yaml` endpoints.

**P2 — Post-pilot scale:**
9. Alert escalation gateway (CODE-READY 2026-09-10: `server/src/events/` + workers, broker-less default; live needs `RABBITMQ_URL` + SMS keys), equipment tracker UI, React Query wiring or removal, WMS-ERP bridge (CODE-READY 2026-09-10: profile adapter + manifest/confirm endpoints; UAT mapping with BAK IT pending), k6 load test (50 concurrent, p95 <500ms reads), ZAP scan.

---
