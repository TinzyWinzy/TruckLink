# Software Architecture Document (SAD)

**Project Title:** RadBit Local-First Operational Intelligence PWA (OpShield)  
**Target System:** BAK Logistics Yard & Gate Control Architecture  
**Prepared For:** Takudzwa Mandiwanza | Business Development Manager, BAK Logistics  
**Prepared By:** Tinotenda Brandon Duma | Lead Systems Architect, RadBit Studios  
**Document Version:** 1.1 (Aligned with as-built MVP)
**Date:** September 2026
**Status:** Engineering Review — §2–§6 updated to match `bak-logistics-app/` + `functions/` as-built. Gaps marked [AS-BUILT] / [DEFERRED].

---

## 1. System Overview & Architectural Style

The **RadBit Operational Intelligence PWA** is designed as a **Local-First, Offline-First Single Page Application (SPA)** [77]. It sits as a non-disruptive intelligence overlay above BAK's existing operational environment, operating completely independently of core legacy WMS/ERP systems during Phase 1 [5].

```
┌─────────────────────────────────────────────────────────┐
│              React 18 + Tailwind CSS UI Layer           │
└───────────────────────────┬─────────────────────────────┘
                            │ Optimistic Reads/Writes (<16ms)
                            ▼
┌─────────────────────────────────────────────────────────┐
│          Local-First Engine (IndexedDB / Dexie.js)      │
│          - Local State & Offline Mutation Queue         │
└───────────────────────────┬─────────────────────────────┘
                            │ Sync Queue Execution
                            ▼
┌─────────────────────────────────────────────────────────┐
│        Workbox Service Worker (vite-plugin-pwa)         │
│        - Asset Precaching & NetworkFirst API Fallback   │
└───────────────────────────┬─────────────────────────────┘
                            │ Encrypted HTTPS (TLS 1.3)
                            ▼
┌─────────────────────────────────────────────────────────┐
│                  Backend Cloud Infrastructure           │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Technology Stack Specification

[AS-BUILT] Pinned versions updated from proposal drafts to match `bak-logistics-app/package.json` and `functions/package.json`. Dexie.js remains the target for Phase 1.1; current MVP uses a dependency-free localStorage queue (see §3).

| Tier | Technology | Specification / Version | Architectural Role |
| :--- | :--- | :--- | :--- |
| **UI Framework** | React | 19.2.8 | Reactive component rendering and state synchronization [24, 79]. |
| **Language** | TypeScript | ~6.0.2 (app) / ~5.6.0 (functions) | Strict type safety across domain models and API payloads [24, 79]. |
| **Styling** | Tailwind CSS | 4.3.3 via `@tailwindcss/vite` | Utility-first, responsive tablet/desktop layouts. |
| **Build Tooling** | Vite | 8.2.2 | Module bundler, HMR, and chunk optimization [24, 79]. |
| **PWA / Service Worker** | `vite-plugin-pwa` | 1.3.0 (`registerType: 'autoUpdate'`, `cleanupOutdatedCaches`, `NetworkFirst api-runtime-cache` 5s/24h/100-entry) | Precached shell + API runtime cache (P0-2 closed). No `lucide-react` in MVP; status uses text + unicode symbols for offline legibility. |
| **Client Database** | Dexie.js | 4.4.5 (`OperationalLocalDB`: `pendingActions`, `inspections`, `syncQueue`) | IndexedDB transactional queue with legacy localStorage one-time migration (P0-1 closed). |
| **Routing / State / Validation** | React Router 7.18.3 / Zustand 5.0.15 / Zod 4.5.4 | As-built | Route guards (`Guard`), session store (`src/store/session.ts` + `canAccess` tests), `axleCheckSchema` + `queueEntrySchema` validation. React Query 5 installed but not yet wired — deferred. |
| **Backend** | Firebase | 12.18.0 (Auth + Firestore) / Admin 13 / Functions 6.3 on Node 20 | System of record: `facilities/{facilityId}/{queue,docks,equipment,complianceChecks,auditLogs,alerts,complianceConfig}`. Hosting split: Vercel hosts Vite PWA; Firebase provides data/auth/functions. Demo mode when `VITE_FIREBASE_*` unset. |
| **API Contract** | OpenAPI 3.0.3 | `bak-logistics-app/openapi.yaml` v0.1.0 | Pilot REST contract for queue/compliance/override/audit/alerts. Functions implement triggers; frontend consumes Firestore directly in MVP. |

---

## 3. Local-First Data Architecture & IndexedDB Schema

[AS-BUILT] Target remains **Dexie.js / `OperationalLocalDB`** below for Phase 1.1. MVP implements the same pattern over localStorage (`src/lib/offline/db.ts`) + Firestore as system of record (`src/lib/live.ts`, `src/lib/firebase.ts`). All UI writes are optimistic; live mode replays via idempotency keys (`q-{key}`, `c-{key}`, `quar-{queueId}`).

MVP behaviour (verified in code):
* Demo mode (no `VITE_FIREBASE_*`): seeded rows in `QueueDashboard`, `DockBoard`, `Alerts`, `AuditLog`; role-picker login (`src/routes/Login.tsx`).
* Live mode: `subscribe('queue'|'docks'|'alerts'|'auditLogs'|'equipment')` Firestore listeners; `registerVehicleLive` / `assignDockLive` (transactional dock check) / `submitComplianceLive` (validate → quarantine + CRITICAL alert on FAIL) / `acknowledgeAlertLive`; `flushPendingActions()` on `online` event + 5s poll in `Layout.tsx`; `CLIENT_AUDIT_ENABLED=true` until Functions own audit exclusively.
* Firestore seed (`seedDemoFacility`): facility `demo-facility`, 4 docks, 3 equipment, `complianceConfig/default` with `axleLimits [8000,9000,9000]` + 5 checklist items + override policy.

Target Dexie schema (Phase 1.1 migration — replaces localStorage queue, same action types):

```typescript
import Dexie, { Table } from 'dexie';

export interface GateInspection {
  id?: number;
  vehicleReg: string;
  haulierName: string;
  axleConfiguration: string;
  measuredAxleWeightKg: number;
  maxPermissibleKg: number;
  status: 'passed' | 'quarantined' | 'pending';
  quarantineReason?: string;
  inspectorId: string;
  timestamp: string;
  synced: boolean;
}

export interface SyncQueueItem {
  id?: number;
  action: 'CREATE_INSPECTION' | 'UPDATE_QUEUE' | 'REBALANCE_LOAD';
  payload: any;
  timestamp: string;
  retryCount: number;
}

export class LocalAppDatabase extends Dexie {
  inspections!: Table<GateInspection>;
  syncQueue!: Table<SyncQueueItem>;

  constructor() {
    super('OperationalLocalDB');
    this.version(1).stores({
      inspections: '++id, vehicleReg, status, timestamp, synced',
      syncQueue: '++id, action, timestamp',
    });
  }
}

export const db = new LocalAppDatabase();
```

---

## 4. Service Worker Caching & Offline Synchronization Strategy

### 4.1 Precaching Pattern
[AS-BUILT] `vite.config.ts` currently precaches static shell only — runtime `NetworkFirst /api/` block from v1.0 is **not yet configured** (gap → Phase 1 fix):

```typescript
// CURRENT (vite.config.ts) — static shell only
VitePWA({
  registerType: 'autoUpdate',
  workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg}'] },
  // MISSING: runtimeCaching for api-runtime-cache (NetworkFirst, 5s timeout, 24h/100-entry)
})

```typescript
workbox: {
  globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  cleanupOutdatedCaches: true,
  runtimeCaching: [
    {
      urlPattern: /\/api\/.*$/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'api-runtime-cache',
        networkTimeoutSeconds: 5,
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 60 * 60 * 24, // 24 hours
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
  ],
}
```

### 4.2 Sync Lifecycle & Conflict Resolution
1. **Offline Write:** User completes inspection on tablet; record is inserted into `inspections` (with `synced: false`) and `syncQueue` [81]. [AS-BUILT MVP: `enqueueOfflineAction('queue.create'|'compliance.submit')` to localStorage; dock assignment explicitly blocked offline — `DockBoard.tsx:53` requires connectivity for the Firestore transaction.]
2. **Connectivity Event:** Workbox or window `online` event triggers background queue flushing. [AS-BUILT: `window online/offline` + 5s interval in `Layout.tsx:34-37` calls `flushPendingActions()`; chronological replay with per-action retry cap 5.]
3. **Queue Execution:** Items are processed sequentially (FIFO) over TLS 1.3 HTTPS POST endpoints. [AS-BUILT: direct Firestore `setDoc merge` with idempotency doc IDs, not REST POST yet — see `openapi.yaml` for target contract.]
4. **Conflict Resolution:** Server timestamp validation enforces Last-Write-Wins (LWW) for queue states, while immutable inspection logs reject overwrites. [AS-BUILT: `serverTimestamp()` writes + Firestore rules `allow update, delete: if false` on `auditLogs`; Functions `onQueueEntryStatusChanged` / `onComplianceCheckCompleted` emit audit entries — double-write risk while `CLIENT_AUDIT_ENABLED=true`.]

---

## 5. Physical Edge Integration Architectures

### 5.1 Weighbridge Indicator Integration (Phase 1)
[DEFERRED — NOT IN MVP] Target pattern preserved. Current MVP is manual weight entry (`ComplianceCheck.tsx` numeric inputs, defaults 6000/8000/8000, total 22000, GVM 24000). No Web Serial / WebSocket reader exists yet — see Phase Plan P1.

```
┌─────────────────────────┐    RS232 / USB / IP    ┌─────────────────────────┐
│ Physical Weighbridge    │ ────────────────────► │  Tablet PWA (Module B)  │
│ Scale Indicator         │   Live ASCII Stream   │  - Auto-Populates Weight │
└─────────────────────────┘                        └─────────────────────────┘
```

### 5.2 Phase 2 Hardware Scaling Extensions
* **RFID Gate Readers:** Integration via WebSockets to automatically detect vehicle IDs upon barrier approach.
* **ANPR Cameras:** Automated license plate capture cross-referencing incoming dispatches against expected manifest schedules.

---

## 6. Security, Encryption & Compliance

* **Data in Transit:** TLS 1.3 encrypted HTTPS channels for all cloud REST/WebSocket communications [10]. [AS-BUILT: Vercel → Firebase SDK TLS; no custom REST yet.]
* **Data at Rest:** AES-256 storage encryption [10]. [AS-BUILT: inherited from Firestore/Cloud Storage.]
* **Access Control:** Role-Based Access Control (RBAC) categorizing permissions into `Gatekeeper`, `Yard Supervisor`, `Operations Manager`, and `System Admin` [10]. [AS-BUILT EXPANDED to 6 system roles — `DISPATCH_SUPERVISOR, FACILITY_MANAGER, OPERATIONS_SUPERVISOR, EXECUTIVE, ADMIN, COMPLIANCE_OFFICER` (`session.ts`, `live.ts`, `firestore.rules`). Auth = Firebase email/password + custom claims `{role, facilities}`; demo-mode role picker when env unset; auditLog reads restricted to COMPLIANCE_OFFICER/ADMIN/EXECUTIVE/FACILITY_MANAGER; queue/compliance writes role-gated; deletes denied. PIN auth from Tech Spec §7.1 not implemented.]
* **Regulatory Compliance Rules Engine:** Encapsulates legal weight limits under **S.I. 129 of 2015** and **S.I. 159 of 2022** (enforcing the USD $0.50/kg overload threshold) [73, 85, 102]. [AS-BUILT: `validateLoad()` in `src/lib/validation/compliance.ts:31` + `canTransition()` quarantine state machine, Vitest-covered; limits sourced from `complianceConfig/default` `[8000,9000,9000]` — S.I. axle tables per route/vehicle-type still to be encoded.]
* **Audit Integrity [AS-BUILT]:** SHA-256 chain `hash(previousHash + payload + salt)` implemented twice — client `appendAuditLive()` (`live.ts:89`) and Functions `appendAuditLog()` (`functions/src/index.ts:16`) + pure helpers `hashAuditEntry/chainEntries/verifyChain` (`audit.ts`) with Node tests. Salt is placeholder `pilot-salt-rotate-me` — must rotate via `AUDIT_SALT` env before prod. Escalation timers (10min → FM, 30min → Exec) logged only, no SMS/email yet.

---

## 7. As-Built Gap Register (drives Phase Plan)

P0 closed 2026-09-09 (14/14 Vitest, `vite build` + PWA SW, `oxlint`, Functions `tsc --noEmit` green).
P1 closed 2026-09-09 (24/24 Vitest, `vite build` + PWA SW 20 entries, `oxlint` green). Functions deploy blocked: staging needs Blaze upgrade — client audit stays authoritative.

| # | Spec clause | As-built | Fix phase |
|---|-------------|----------|-----------|
| G1 | §2 Dexie | ✅ Dexie 4.4.5 `OperationalLocalDB` live, legacy migration + 120-action test | CLOSED P0-1 |
| G2 | §4 runtimeCaching + persistence | ✅ Workbox `NetworkFirst api-runtime-cache` + Firestore `persistentLocalCache` multi-tab | CLOSED P0-2 |
| G3 | §5.1 Weighbridge serial/IP | ✅ Web Serial reader (`serial.ts` parser + stable capture into Total) with Chromium fallback | CLOSED P1-1 |
| G4 | FR-A4 reports export | ✅ `Reports.tsx`: wait/turnaround/overdue/dock-util + CSV export; `releaseVehicleLive` stamps `exitTimestamp` | CLOSED P1-2 |
| G5 | Audit double-write | ✅ `VITE_CLIENT_AUDIT_ENABLED` flag + `verifyAuditChainLive()` linkage check; cutover EITHER via Functions staging deploy (Blaze-gated) OR `npm run relay` self-hosted Firestore relay (Spark-compatible, no Blaze — `server/src/firestore-relay/`), then set flag false | CODE-READY, operator choice |
| G6 | `AUDIT_SALT` placeholder | ✅ `VITE_AUDIT_SALT` env wired, placeholder warns; rotation at deploy | CODE-READY P0-3, deploy pending |
| G7 | Alert escalation SMS/email | Log-only in `onAlertCreated` | P2 — gateway + scheduled check |
| G8 | Roles 4 → 6 | ✅ Code has 6, docs aligned; `canAccess` matrix tested; prod demo-picker fail-closed | CLOSED P0-4 |
| G9 | React Query / GraphQL Phase 2 | ✅ Pruned 2026-09-10: zero imports in `src/`, dep removed; `openapi.yaml` REST unimplemented | CLOSED (re-add only with a wired use-case) |
| G10 | Phase 4 async orchestration | ✅ `server/src/events/` (topic `bak.events`, DLX 10m/30m timers, outbox relay) + 4 workers; broker-less pilot default | CODE-READY — needs `RABBITMQ_URL` + vendor keys for live escalation |
| G11 | Phase 5 WMS/ERP bridge | ✅ `server/src/wms/adapter.ts` (generic-http/sap/syspro envelopes) + `POST /api/wms/manifest` + idempotent `POST /api/wms/confirm` (`billed`, `erp_reference`) | CODE-READY — UAT field mapping with BAK IT pending |
| G12 | Phase 6 control tower + SLA engine | ✅ `GET /api/analytics/{heatmap,surge,roi}` + `Reports.tsx` surge banner, fines-intercepted ROI, 14d heatmap (server-backed via `VITE_SYNC_API_URL`, honest empty states otherwise) | CODE-READY — needs sync-service URL + traffic for baselines |
| G13 | Security posture | ✅ `server/SECURITY.md`: API-key auth + upload table/column allow-list + `RoleGuard` matrix (`gates.test.ts`) + fixed `firestore.rules` (docks/equipment writes, scoped alert create/update) | CODE-READY — per-user token verification + salt rotation + k6/ZAP before prod |

---
