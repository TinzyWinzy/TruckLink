# BAK OpShield — Security Posture (pilot)

Target: 3 yard tablets + 1 sync service + Firebase, intermittent connectivity,
low-spec Android. Posture is **pilot-grade**: stops casual abuse, honest about
what must harden before multi-tenant prod. Reality over narrative — every
"NOT YET" below is a deploy gate, not a roadmap wish.

## Trust boundaries

| # | Boundary | Enforced by | Status |
|---|----------|-------------|--------|
| 1 | Tablet → sync service writes | `X-API-Key` (`SYNC_API_KEY`, 16+ chars) + table/column allow-list (`src/sync.ts`) + zod shapes | LIVE |
| 2 | Tablet → Firestore | `firestore.rules` (custom claims `{role, facilities}`) + client route gates (`src/lib/gates.ts`, tested) | LIVE |
| 3 | ERP → `/api/wms/*` | Same API key (shared with BAK IT out-of-band) + zod + idempotent confirms | LIVE |
| 4 | Broker → workers | `RABBITMQ_URL` credentials + topology asserted on boot; SMS senders throw on failure (nack/retry, no silent loss) | LIVE |
| 5 | Per-user identity on sync service | **NOT YET** — shared pilot key only (see §3) | GATE |

## What changed (this pass)

- **SQL injection closed**: `/api/sync/upload` interpolated client table/column names. Now `SYNC_TABLES` allow-list rejects unknown tables (`outbox_events` not writable) and columns before Postgres. Covered by `src/auth.test.ts`.
- **Auth added**: `requireApiKey` on upload, token mint, publish, relay, `wms/*`, `analytics/*`. `/api/health` stays open (no data). Unset key = open dev mode with boot warning — never deploy networked that way.
- **Token mint hardened**: `facilityId` format-validated; identity is an explicit `userId` param (was: raw Bearer string trusted as userId). Expiry 24h, HS256.
- **Firestore rules fixed**: `docks`/`equipment` had NO explicit rule → fell to ADMIN-only writes, so supervisor dock assignment was denied in live mode. Now `OPERATIONS_SUPERVISOR`/`FACILITY_MANAGER` can update. `alerts` create was denied (broke the client's optimistic quarantine alert) while update was allow-any-facility-user; now create + update are operational-role-scoped.
- **Client gates**: `App.tsx` checked sign-in only — any role opened `/admin` and `/audit`. Now `RoleGuard` per `ROUTE_GATES` (tested in `gates.test.ts`), mismatch renders a dead-end, never a redirect loop. PROD build stays demo-picker-free (`Login.tsx`).
- **Transport hygiene**: 1 MB JSON cap, `nosniff`/`DENY` frame/`no-referrer` headers, configurable `CORS_ORIGIN`.

## Deploy checklist (pilot → networked)

- [ ] `SYNC_API_KEY` (16+ random chars) on server + `VITE_SYNC_API_KEY` on tablets; rotate quarterly
- [ ] `POWERSYNC_JWT_SECRET` (32+ chars) — boot warns while default
- [ ] `CORS_ORIGIN=https://<vercel-app>` — no wildcard
- [ ] `AUDIT_SALT` rotated + `VITE_AUDIT_SALT` matched; then `VITE_CLIENT_AUDIT_ENABLED=false` after Functions deploy (Blaze-gated, still pending)
- [ ] RabbitMQ user per environment (no `guest` remote); workers on a supervised host
- [ ] Postgres: TLS + least-privilege role for the service (today: superuser-style `DATABASE_URL`)
- [ ] Firestore relay: service account with ONLY Cloud Datastore User on the
  Firebase project; key lives in `BAK/.secrets/` (gitignored by pattern AND
  directory — verified), referenced via `FIREBASE_SERVICE_ACCOUNT_FILE`, never
  committed; rotate if any tablet/VPS is compromised

## Residual risks (accepted for pilot, gated for prod)

1. **Shared API key, no per-user auth on sync service.** A leaked tablet key = full sync write as any facility. Mitigation path: verify Firebase ID tokens with `firebase-admin` in `requireApiKey`, scope `facility_id` from the token, keep the key as device attestation. Do before second facility.
2. **Secrets in env, no manager.** Fine for one VPS; use Doppler/SM or the host's secret store before prod.
3. **No rate limiting.** Express has no throttler; abuse = noisy logs + 1 MB cap only. Add `express-rate-limit` (or edge) before public exposure.
4. **Audit double-write still on** (`VITE_CLIENT_AUDIT_ENABLED=true`) until Functions deploy; chain uses placeholder salt in dev.
5. **k6 load + ZAP scan not run.** Staging targets: 50 concurrent, p95 reads < 500 ms; fix ZAP highs before go-live.
