# BAK OpShield — Security Posture (Phase hardened)

Target: 3 yard tablets + 1 sync service + Firebase, intermittent connectivity,
low-spec Android. Posture hardened against the initial audit: per-user identity,
server-owned audit chain, prod fail-closed boot. Accepted pilot risks are
documented in `Residual risks` at the bottom.

## Trust boundaries

| # | Boundary | Enforced by | Status |
|---|----------|-------------|--------|
| 1 | Tablet → sync service writes | Firebase ID token (`Authorization: Bearer`) verified server-side (`requireFirebaseIdentity`), facility from custom claims, table/column allow-list (`src/sync.ts`), zod shapes | LIVE |
| 2 | Tablet → Firestore | `firestore.rules` (custom claims `{role, facilities}`) + client route gates (`src/lib/gates.ts`, tested) | LIVE |
| 3 | ERP → `/api/wms/*` | Separate `WMS_API_KEY` (never in browser), zod + idempotent confirms | LIVE |
| 4 | Broker → workers | `RABBITMQ_URL` credentials + topology asserted on boot; SMS senders throw on failure (nack/retry, no silent loss) | LIVE |
| 5 | Per-user identity on sync service | **LIVE** — Firebase ID token, facility scoped to claims; shared key removed from sync path | DONE |

## What changed (this pass — security audit implementation)

- **Per-user identity (H1):** `/api/auth/powersync-token` and `/api/sync/upload` verify Firebase ID tokens server-side via `verifyIdToken` (needs only `FIREBASE_PROJECT_ID`; no SA). Facility comes from the `facilities` custom claim. The old shared `X-API-Key` (`VITE_SYNC_API_KEY`) is no longer accepted on tablet endpoints. WMS endpoints get their own `WMS_API_KEY`. Client sends `Authorization: Bearer <id-token>`.
- **Sync column allow-list tightened (H2):** `users.role`, `users.facility_id`, `queue_entries.billed`, `queue_entries.erp_reference` removed — clients cannot overwrite roles, billing flags, or ERP reference. Server-owned `audit_logs` path added (server fills `previous_hash`/`hash` inside a locked transaction; client supplies facts only).
- **Server-owned audit chain (H3/M3):** client audit writes removed entirely (`live.ts`, `operations.ts`); rules deny client `auditLogs` create. Salt is fail-closed (unset = refusal, no placeholder fallback). Relay + Cloud Functions serialize concurrent appends on a per-facility `_meta/audit` Firestore doc; Postgres side uses `audit_meta` + `SELECT ... FOR UPDATE` (`server/src/audit/append.ts`).
- **Storage rules scoped (M1):** compliance photo uploads/reads restricted to `inFacility` claim + gate/supervisor roles; image type/size enforced.
- **Fail-closed prod boot (M2):** `assertBootSecrets()` refuses to start in production without `SYNC_API_KEY`, `WMS_API_KEY`, `POWERSYNC_JWT_SECRET` (32+), and `FIREBASE_PROJECT_ID`. Dockerfile runs `NODE_ENV=production`; prod compose overlay forces credential substitution (fails when unset).
- **Data validation in rules (M4/L4):** enum checks on `queue.status`, `alerts.severity/status`, `complianceChecks.overallStatus`. `complianceConfig` explicitly ADMIN-only writes.
- **Ops endpoints authed (L1):** `/api/events/status` behind `requireApiKey`.
- **Error leak closed (L2):** 500 responses never expose `err.message` (single generic body, real error in server logs).
- **SSH hardened (L3):** cloud-init disables root login, password auth; sudo restricted to compose/systemctl/file reads.
- **802.1X/relay:** server `events/push.ts` reuses shared `firebase/app.ts` app (no double-init); relay uses `getAdminApp()` singleton.

## Deploy checklist (pilot → networked)

- [x] `POWERSYNC_JWT_SECRET` (32+ chars) — hard-fail boot, no fallback
- [x] `SYNC_API_KEY` (16+ random chars) on server; no client-side key shipped
- [x] `WMS_API_KEY` (16+ random chars) — separate from tablet credential
- [x] `AUDIT_SALT` set (fail-closed when unset); `VITE_AUDIT_SALT` / `VITE_CLIENT_AUDIT_ENABLED` removed
- [x] `CORS_ORIGIN=https://<vercel-app>` — no wildcard
- [ ] RabbitMQ user per environment (no `guest` remote); workers on a supervised host
- [ ] Postgres: TLS + least-privilege role for the service (today: superuser-style `DATABASE_URL`)
- [ ] Firestore relay: service account with ONLY Cloud Datastore User on the
  Firebase project; key lives in `BAK/.secrets/` (gitignored by pattern AND
  directory — verified), referenced via `FIREBASE_SERVICE_ACCOUNT_FILE`, never
  committed; rotate if any tablet/VPS is compromised

## Residual risks (accepted for pilot, gated for prod)

1. **No rate limiting.** Express has no throttler; abuse = noisy logs + 1 MB cap only. Add `express-rate-limit` (or edge) before public exposure.
2. **Secrets in env, no manager.** Fine for one VPS; use Doppler/SM or the host's secret store before prod.
3. **k6 load + ZAP scan not run.** Staging targets: 50 concurrent, p95 reads < 500 ms; fix ZAP highs before go-live.
4. **Firebase emulator rules testing not wired in CI.** Rules are manually tested; add `firebase emulators:start` + rules unit tests before multi-facility rollout.
