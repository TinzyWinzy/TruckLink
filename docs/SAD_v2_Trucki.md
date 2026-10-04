# Trucki — System Architecture Document (SAD) v2

**Product:** Trucki — African Logistics Operations Platform
**Prepared by:** Tinotenda Brandon Duma | RadBit Studios
**Version:** 2.0 | **Date:** October 2026
**Status:** Build specification for Release 1. Companions `docs/PRD_v2_Trucki.md`.
**Supersedes:** `Technical_Spec_v1_BAK_Logistics_Operational_Intelligence_Layer.txt`, `bak-pwa-sad.md` (retained as evidence of the BAK as-built system), `spotterAI/docs/architecture.md` (stale).

---

## 1. Context & goals

Two proven codebases, one product:

| Source | Keeps | Loses |
| :--- | :--- | :--- |
| BAK OpShield (React PWA + Firebase + Node sync svc) | Frontend shell: offline outbox, PIN login, role gates, weighbridge serial, compliance UX, audit UX | Firebase/Firestore data path, BAK branding, Cloud Functions |
| Trucki (Django + DRF + React) | Backend platform: DRF permissions/org scoping, trip domain (R2), geocoding/routing, WhatsApp bot (R2), pytest suite | Its React frontend (merged into BAK shell), HOS engine, US scope, Render free-tier config |

Architecture goal for R1: **one Django API, one Postgres database, one React SPA, one tenant model** — production-grade for the first paying yard, cheap to run for demos.

## 2. Architecture decisions (ADR)

| # | Decision | Rationale | Rejected alternative |
| :--- | :--- | :--- | :--- |
| D1 | **Django 6 + DRF is the platform** | Trucki's domain (org scoping, FSM, tests) is the largest intact backend; BAK's backend was infra, not domain | Node `server/` (smaller domain, would force Python→TS port of the larger system) |
| D2 | **Postgres only; Firebase retired at R1 cutover** | One datastore, no dual path, no per-project rules, no Blaze billing dependency | Keeping Firestore for BAK screens (two stacks forever, client-data boundary problems) |
| D3 | **BAK's PWA shell is the frontend**, rewired to REST | Highest-value frontend (offline, tablet UX, weighbridge) already built and tested | Trucki's SPA (no offline, no PWA depth) |
| D4 | **Trucki's `operations.ts` shape is the API adapter contract** | The REST-shaped functions already exist in BAK's code with tests (`registerVehiclePS`, `submitCompliancePS`, …) — rename + point at HTTP | Inventing a new client layer |
| D5 | **Polling (5s) for live boards; SSE later if needed** | BAK already runs a 5s poll; yard boards don't need sub-second latency | Firestore listeners / websockets (complexity without R1 value) |
| D6 | **Server-authoritative rules** (DRF permissions + serializer validation) | Multi-tenant product cannot rely on client gates; BAK's `firestore.rules` semantics move server-side | Client-side enforcement (BAK's interim posture) |
| D7 | **Auth: Django tokens + session, PIN mapped to synthetic credentials** | No IdP dependency; PIN scheme already proven at BAK (renamed `TRK-…`) | Firebase Auth as IdP (keeps D2 partially alive) |
| D8 | **WhatsApp via Twilio** (inbound bot + outbound alerts) | Trucki webhook already signature-verified; BAK's Meta Cloud API notify code is ported later if cost/route favours it | Meta Cloud API only (no inbound bot today) |
| D9 | **Monorepo**: `backend/` (Django) + `frontend/` (BAK shell) + `docs/` | One CI, one clone; histories grafted (B0) | Two repos (the current state that caused drift) |

## 3. System overview

```
                    ┌────────────────────────────────────────────┐
 tablets/phones ───► │  React 19 + Vite PWA (BAK shell)          │
 desktops       ───► │  routes · role gates · offline outbox     │
 WhatsApp user  ───► │  weighbridge (Web Serial) · Leaflet (R2)  │
                    └───────────────┬────────────────────────────┘
                                    │ HTTPS JSON (Token auth)
                    ┌───────────────▼────────────────────────────┐
 Twilio webhook ──► │  Django 6 + DRF                            │
                    │  permissions (tenant/role) · FSM guards    │
                    │  compliance engine · audit chain service   │
                    │  notify dispatcher (WhatsApp/SMS/push)     │
                    └───────┬───────────────────────┬────────────┘
                            │                       │
                    ┌───────▼───────┐      ┌────────▼─────────┐
                    │  PostgreSQL   │      │  Side effects    │
                    │  (all tenants)│      │  outbox → tasks  │
                    └───────────────┘      └──────────────────┘
```

No Firebase, no RabbitMQ, no PowerSync in R1. Side effects start as a transactional **outbox table + management command** (broker added only when volume demands — BAK's `server/src/events/` remains the reference design).

## 4. Data model (merged, Postgres)

Tenancy spine: `organisation` → `facility` → domain rows. Every domain table carries `organisation_id`; yard tables also carry `facility_id`.

**Platform `[NEW]`**
- `organisation` (name, slug, plan, licence fields — from Trucki) · `facility` (name, timezone, yard config) — *new*
- `user`, `user_profile` (user ↔ organisation, role), `pin_credential` (staff id, hash) — from BAK's PIN design
- `invite`, `audit_meta` (per-facility `current_hash`, `seq`), `outbox_event`, `notification_log`

**Yard module `[PORT-FROM-BAK]`**
- `queue_entry` — status `QUEUED|ASSIGNED|AT_DOCK|QUARANTINED|PENDING_OVERRIDE|OVERRIDE_APPROVED|RELEASED|COMPLETED`, entry/exit timestamps, idempotency key
- `dock` (name, status), `equipment`, `alert` (severity, ack), `compliance_check` (checklist JSON, measured weights, `overload_kg`, `overload_fee_usd`, status, override fields), `compliance_config` (S.I. tables per tenant: route × vehicle type), `audit_log` (append-only: `previous_hash`, `hash`, `payload`, `actor`, `facility_id`)

**Fleet module `[PORT-FROM-TRUCKI]` (schema now, behavior in R2)**
- `vehicle`, `driver`, `commodity_category`, `commodity`, `trip` (state machine `inquiry…paid`, costs, booking reference, customer token), `fuel_record`, `trip_status_log`, `trip_position`, `trip_image`, `customer_profile`, `whatsapp_session`

Migration order: **0001 platform → 0002 yard → 0003 fleet** (fleet tables land in R1 only if free; otherwise R2 — no R1 code depends on them).

## 5. Auth, tenancy & authorization

- **Authentication:** DRF `TokenAuthentication` + session for web; PIN login = `POST /api/auth/pin/` exchanging `TRK-<staff-id>` + PIN for a token (synthetic user creation is admin-only, mirroring BAK's `provision-pin` but server-owned).
- **Tenancy:** `get_user_organisation / scope_organisation / belongs_to_organisation` (Trucki `permissions.py:7-39`) is the base. R1 extension: **facility scoping** — `scope_facility(qs, user)` requires `facility_id ∈ user.facilities`. Staff bypass is **removed** for production (BAK's `is_staff` shortcut is a demo liability); platform admin role replaces it.
- **RBAC matrix:** the six BAK roles map to DRF permission classes per action (read/write per resource). Client `gates.ts` is retained as UI affordance only, with a comment that the server is authoritative.
- **Mandatory tests:** for every rule, a negative test (wrong tenant → 404/403, wrong role → 403, self-approval of override → 403). Cross-tenant tests are release-blocking (PRD risk R2).
- **Public surfaces:** booking status by `customer_token` (R3); nothing public in R1.

## 6. Audit chain (ported from `server/src/audit/append.ts`)

Algorithm (byte-for-byte semantics preserved):

1. `require_salt()` — missing `AUDIT_SALT` ⇒ raise, refuse append (**fail-closed**).
2. Upsert `audit_meta(facility_id, current_hash='GENESIS', seq=0)`.
3. `SELECT … FOR UPDATE` on the facility's meta row ⇒ serializes concurrent tablets; chain cannot fork.
4. `hash = sha256(previous_hash + payload + salt)`; `INSERT audit_logs … ON CONFLICT (id) DO NOTHING` (offline idempotency).
5. Advance meta **only if the insert happened** (replay = no-op).

Client never computes or stores hashes (BAK's G5 lesson). Verification: `verify_chain(facility)` walks all rows; exposed as `GET /api/audit/verify/` to `COMPLIANCE_OFFICER`+ and as an automated test that appends N entries and detects tampering.

## 7. Offline strategy (ported from BAK SAD §offline)

| Concern | Design |
| :--- | :--- |
| Storage | IndexedDB (Dexie) `OperationalLocalDB` — BAK's P0 target, shipped as part of the rewire (localStorage fallback removed) |
| Outbox API | `enqueueOfflineAction / listPendingActions / removePendingAction / recordActionFailure` (`offline/db.ts`) — unchanged contract |
| Replay | on `online` + 5s tick; **idempotency key** per action; server returns stored row (replay-safe) |
| Conflicts | Server timestamps win; LWW for mutable rows; audit/immutable rows reject overwrite |
| Offline-capable | queue create, compliance submit, checklist draft |
| Online-only (by design) | dock assign (transactional), release, override approve, audit append |
| Failure UX | persistent pending-count badge; failed action visible with reason; never silent loss |

Field rule: the app must remain fully usable for a gate shift with zero connectivity for ≥ 2 hours, then sync without operator action.

## 8. Realtime & sync

5-second polling of `/api/yard/board?facility=` (queue + docks + alerts digest) for the active screens; long-poll optional. SSE is an R2 evaluation only if polling shows in dashboards. This replaces Firestore listeners — acceptable because BAK's own layout already polls at 5s.

## 9. Compliance engine (server-side port)

Port `validateLoad()` / `canTransition()` / `validation/siTables` semantics into `compliance/engine.py`:

- inputs: measured total + axle weights, vehicle type, route, tenant S.I. config
- outputs: `PASS | FAIL`, `overload_kg`, `overload_fee_usd` (0.50/kg), per-axle findings
- **API-side enforcement:** `POST /api/compliance/` validates and, on FAIL, transitions `queue_entry → QUARANTINED` + creates `quar-<id>` critical alert in the **same transaction**; `release` endpoint refuses unless `COMPLETED` or `OVERRIDE_APPROVED`.
- Override: requester ≠ approver (hard server check), reason required, both actors recorded on the audit chain.
- Client keeps the same engine for instant UI feedback (Vitest), but server result is final.

## 10. Notifications

R1 path: state change → `outbox_event` (transactional) → `notify` command → WhatsApp (Twilio, template `quarantine_alert`) → SMS fallback → web push (VAPID), with `notification_log` recording per-leg results. Escalation timers logged only (10 min FM / 30 min Exec) until channels are credentialled. Never block a yard transaction on a provider call.

## 11. API surface (R1)

```
POST /api/auth/login/ | /api/auth/pin/ | /api/auth/logout/ | GET /api/auth/me/
POST /api/tenancy/signup/            # org + facility + admin user
GET  /api/yard/board?facility=       # queue+docks+alerts digest (poll target)
GET/POST /api/queue/   PATCH /api/queue/{id}/  POST /api/queue/{id}/release
GET/POST /api/docks/   POST /api/docks/{id}/assign
GET/POST /api/compliance/  POST /api/compliance/{id}/override-request
POST /api/compliance/{id}/override-approve
GET  /api/alerts/  POST /api/alerts/{id}/ack
GET  /api/audit/  GET /api/audit/verify/  GET /api/audit/export.csv
GET  /api/reports/turnaround?facility&from&to   GET /api/reports/export.csv
POST /api/admin/seed  POST /api/admin/reset      # demo yard
```

All write endpoints: token + role + tenant/facility scope. OpenAPI generated from DRF serializers (replaces BAK's hand-kept `openapi.yaml`).

## 12. Frontend architecture

- BAK shell kept intact: `App.tsx` routes, `RoleGuard`, `Layout`, `sw.ts` (PWA), `weighbridge/serial.ts`, `validation/*`, `gates.ts` (advisory), Guide/Hub screens (copy genericised).
- **Rewire:** delete `firebase.ts` + `live.ts` Firestore subscriptions; implement `src/lib/api/` with one module per `operations.ts` function (same names/args minus PowerSync) → fetch with token header.
- `liveGate.ts` (practice mode) kept; demo picker gated out of production builds (BAK P0-4).
- Copy pass: `BAK Intel/OpShield` → Trucki; `Tafadzwa/Takudzwa` → generic roles; PIN prefix → `TRK-`; storage keys `bak-*` → `trk-*`; CSV prefixes likewise (grep list in PRD §5.8 FR-H4).
- R2 adds Trucki's screens (`/app/trips`, `/live-map`, `/driver`, `/book`) as new route modules + lazy `leaflet` chunk.

## 13. Deployment, environments, CI

| Env | Frontend | Backend | DB |
| :--- | :--- | :--- | :--- |
| Demo (R1) | Vercel project `trucki` | Render (or VPS compose) | managed Postgres / container |
| Prod | Vercel project `trucki-prod` | same host, separate DB | same |

- `render.yaml` rewritten: `DEBUG=False`, explicit `ALLOWED_HOSTS`, no `CORS_ALLOW_ALL_ORIGINS` (BAK/Trucki security findings both fixed here).
- Secrets: env vars only; `.env.production` stays gitignored (OIDC token rule learned 2026-10-04); never commit `db.sqlite3`.
- CI (GitHub Actions, 3 jobs): backend pytest · frontend oxlint + vitest + build · Playwright e2e (boots Django + seeds tenant).

## 14. Testing strategy

| Suite | Source | R1 treatment |
| :--- | :--- | :--- |
| Trucki pytest (~15 files) | existing | keep green; extend with tenant/facility scope tests |
| BAK Vitest (gates, SI tables, weight engine, PIN, offline) | existing | port assertions; engine tests become server-mirrored |
| Playwright: BAK e2e + Trucki e2e (27) | existing | BAK suite re-pointed at REST; Trucki suite kept for R2 routes |
| **New:** audit chain test (append N, verify, tamper-detect) | — | release-blocking |
| **New:** cross-tenant negative matrix | — | release-blocking |
| **New:** offline outbox integration (enqueue → replay → idempotent server) | — | release-blocking |
| k6 (50 concurrent, p95 < 500ms) | BAK P2 | before first paid deployment |

## 15. Retirements & migration

- **Retired:** Firebase projects for the product (`radbit-bak-*` stay frozen as BAK evidence), Cloud Functions, `server/` Node sync service, PowerSync path, RabbitMQ topology, Trucki Render free-tier app at R1 cutover.
- **Data migration:** none required (no paying tenants, no production data). Demo seeds recreated via `/api/admin/seed`.
- **Reference keeps:** `server/src/events/*` (notification design), `server/src/wms/*` (R3), `firestore.rules` (source of the RBAC matrix to port).

## 16. Gap register (open at SAD v2.0)

| ID | Gap | Target |
| :--- | :--- | :--- |
| G1 | Audit chain live path unverified post-Firebase (BAK's open question) | Closed by §6 test before first compliance demo |
| G2 | Weighbridge field-test (Avery/Rice Lake) never done | Demo = manual entry until tested (PRD R5) |
| G3 | Dexie/IndexedDB migration (BAK P0-1) unfinished | Done as part of §12 rewire |
| G4 | Salt rotation + export/verify UI (BAK P0-3/4) | R1 (§6) |
| G5 | Auto/surge dock algorithm (BAK FR-A2/A3) | R1.1 backlog, not R1 |
| G6 | Twilio vs Meta channel unification (PRD open q.2) | before R2 bot |
