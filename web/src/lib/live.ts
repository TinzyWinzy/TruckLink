/**
 * Live yard data layer. REST adapter over the Trucki Django backend.
 *
 * Export names and camelCase row shapes match the old Firestore layer, so
 * routes consume this unchanged:
 * - `VITE_API_URL` unset       -> demo mode, screens use local seeds.
 * - configured + signed out    -> subscribe returns null (gated by isRealLive).
 * - configured + real session  -> polling reads + idempotent REST writes.
 *
 * Server is authoritative for compliance + overrides (SAD §9); the client
 * only renders. Firebase survives solely for web push (push.ts / sw.ts).
 */
import { apiFetch, apiBase, ApiError, clearToken, facilityId, selectFacility, getToken, isLive, setToken, setRefreshToken, hasSession } from './api'
import { isRealLive } from './liveGate'
import { useSession } from '../store/session'
import type { TenantConfiguration } from './tenant'
import {
  listPendingActions,
  recordActionFailure,
  removePendingAction,
  type PendingAction,
} from './offline/db'
import { resolveSiLimits, type SiRemoteConfig } from './validation/siTables'

export { facilityId, isLive }
export interface LiveRow extends Record<string, unknown> {
  id: string
}

const ROLES = [
  'DISPATCH_SUPERVISOR',
  'FACILITY_MANAGER',
  'OPERATIONS_SUPERVISOR',
  'EXECUTIVE',
  'ADMIN',
  'COMPLIANCE_OFFICER',
] as const

export type LiveRole = (typeof ROLES)[number]

function hasRole(value: unknown): value is LiveRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

interface SessionUser {
  baseRole: LiveRole
  uid: string
  role: LiveRole
  displayName: string
}

function sessionFrom(user: {
  id?: string | number
  username?: string
  role?: string
  base_role?: string
  organisation?: { id: number; name: string; slug: string } | null
  facilities?: { id: number; name: string; slug: string }[]
  tenant_configuration?: TenantConfiguration | null
}): SessionUser {
  if (!hasRole(user.role)) {
    clearToken()
    throw new Error(
      'This account has no job assigned. Ask your supervisor to set up your account.',
    )
  }
  const facilities = user.facilities ?? []
  let previous = useSession.getState().workspace?.selectedFacility
  try { previous = localStorage.getItem(`trucki-yard-${user.id}`) ?? previous } catch { /* storage unavailable */ }
  const selected = facilities.find(f => String(f.id) === previous) ?? facilities[0]
  selectFacility(selected ? String(selected.id) : '')
  useSession.getState().setWorkspace({ organisation: user.organisation ?? null, facilities, selectedFacility: facilityId, configuration: user.tenant_configuration ?? null })
  return {
    baseRole: hasRole(user.base_role) ? user.base_role : user.role,
    uid: String(user.id ?? ''),
    role: user.role,
    displayName: user.username ?? 'Trucki user',
  }
}

// --- Auth (FR-C1) --------------------------------------------------------------

export async function signInLive(
  email: string,
  password: string,
): Promise<SessionUser> {
  if (!isLive()) throw new Error('Sign-in not connected (practice mode)')
  const data = await apiFetch<{ token: string; refresh_token?: string; user: { id: number; username: string; role?: string } }>(
    '/auth/login/',
    { method: 'POST', body: { username: email, password } },
  )
  setToken(data.token)
  setRefreshToken(data.refresh_token)
  return sessionFrom(data.user)
}

/** Shift-PIN login: TRK staff id + PIN straight to the backend (SAD §5). */
export async function signInPinLive(
  staffId: string,
  pin: string,
): Promise<SessionUser> {
  if (!isLive()) throw new Error('Sign-in not connected (practice mode)')
  const data = await apiFetch<{ token: string; refresh_token?: string; user: { id: number; username: string; role?: string } }>(
    '/auth/pin/',
    { method: 'POST', body: { staff_id: staffId.trim(), pin: pin.trim() } },
  )
  setToken(data.token)
  setRefreshToken(data.refresh_token)
  return sessionFrom(data.user)
}

/** Rehydrate a signed-in session after refresh (token in localStorage).
 * Returns null when signed out, demo mode, or offline at boot. */
export async function restoreSessionLive(): Promise<SessionUser | null> {
  if (!isLive() || !hasSession()) return null
  try {
    const data = await apiFetch<{ user: { id: number; username: string; role?: string } }>(
      '/auth/me/',
    )
    return sessionFrom(data.user)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearToken()
      return null
    }
    throw error
  }
}

export async function signOutLive(): Promise<void> {
  try {
    if (isLive()) await apiFetch('/auth/logout/', { method: 'POST' })
  } catch {
    // Token already dead. clearing below is what matters.
  }
  clearToken()
}

// --- One-time demo yard (ADMIN only, idempotent) -------------------------------

export async function seedDemoFacility(): Promise<void> {
  await apiFetch('/admin/seed/', { method: 'POST', body: { facility: facilityId } })
}

// --- Reads (polling adapter for the old onSnapshot API) ------------------------

const POLL_MS = 5000

type Feed = 'queue' | 'docks' | 'alerts' | 'auditLogs' | 'equipment'

function facQS(): string {
  return `facility=${encodeURIComponent(facilityId)}`
}

function mapQueue(r: Record<string, unknown>): LiveRow {
  return {
    id: String(r.id),
    licensePlate: r.reg_number,
    driverName: r.driver_name,
    haulier: r.haulier,
    vehicleType: r.vehicle_type,
    cargoType: r.cargo_type,
    expectedDestination: r.expected_destination,
    status: r.status,
    assignedDockId: r.assigned_dock ?? null,
    entryTimestamp: r.entry_timestamp,
    exitTimestamp: r.exit_timestamp,
    milestoneSemantics: r.milestone_semantics,
    releaseAuthorizedAt: r.release_authorized_at,
    dockVacatedAt: r.dock_vacated_at,
    journeyTripId: r.journey_trip_id,
    dwellDurationSeconds: r.dwell_duration_seconds,
    updatedAt: r.updated_at,
  }
}

function mapDock(r: Record<string, unknown>): LiveRow {
  return {
    id: String(r.id),
    name: r.name,
    status: r.status,
    currentAssignment: r.current_entry ?? null,
    capacityKg: r.capacity_kg,
  }
}

function mapAlert(r: Record<string, unknown>): LiveRow {
  const acknowledged = Boolean(r.acknowledged)
  return {
    id: String(r.id),
    severity: r.severity,
    message: r.message,
    type: r.category,
    status: acknowledged ? 'ACKNOWLEDGED' : 'ACTIVE',
    acknowledged,
    acknowledgedBy: r.acknowledged_by ?? null,
    relatedQueueEntry: r.related_queue_entry ?? null,
    timestamp: r.timestamp,
  }
}

function shortId(raw: unknown): string {
  const s = String(raw ?? '')
  return s.length > 12 ? s.slice(0, 8) : s
}

function mapAudit(r: Record<string, unknown>): LiveRow {
  let payload: Record<string, unknown> = {}
  try {
    const raw = r.payload
    payload = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : ((raw as Record<string, unknown>) ?? {})
  } catch {
    payload = {}
  }
  const checkId = payload.checkId ?? payload.check_id
  const entryId = payload.queueEntryId ?? payload.queue_entry_id ?? payload.id
  const entityType = checkId ? 'check' : entryId ? 'queue' : ''
  const entityId = checkId ?? entryId
  return {
    id: String(r.id),
    action: r.action,
    entityType,
    entityId: shortId(entityId),
    actor: r.actor ?? r.actor_ref ?? '',
    currentHash: r.hash,
    previousHash: r.previous_hash,
    timestamp: r.timestamp,
    payload,
  }
}

async function fetchFeed(name: Feed, max: number): Promise<LiveRow[]> {
  if (name === 'auditLogs') {
    const data = await apiFetch<{ entries?: Record<string, unknown>[] }>(
      `/audit/?${facQS()}`,
    )
    return (data.entries ?? []).slice(0, max).map(mapAudit)
  }
  if (name === 'equipment') {
    // No equipment read API in R1 (board covers queue/docks/alerts).
    return []
  }
  const board = await apiFetch<{
    queue?: Record<string, unknown>[]
    docks?: Record<string, unknown>[]
    alerts?: Record<string, unknown>[]
  }>(`/yard/board/?${facQS()}`)
  if (name === 'queue') return (board.queue ?? []).map(mapQueue)
  if (name === 'docks') return (board.docks ?? []).map(mapDock)
  return (board.alerts ?? []).map(mapAlert)
}

/** Poll a feed every POLL_MS (REST replacement for Firestore onSnapshot). */
export function subscribe(
  name: Feed,
  cb: (rows: LiveRow[]) => void,
  max = 100,
  onError?: (message: string | null) => void,
): (() => void) | null {
  if (!isRealLive()) return null
  let stopped = false
  let warned = false
  let inFlight = false
  const identity = useSession.getState().userId
  const tick = async () => {
    if (stopped || inFlight || identity !== useSession.getState().userId || !isRealLive()) return
    inFlight = true
    try {
      const rows = await fetchFeed(name, max)
      if (!stopped && identity === useSession.getState().userId) {
        cb(rows)
        onError?.(null)
      }
    } catch (err) {
      if (!stopped && identity === useSession.getState().userId) onError?.('Server data unavailable. displayed records may be stale. Retry when connected.')
      if (!warned) {
        warned = true
        console.warn(`[live] ${name} poll failed: ${(err as Error).message}`)
      }
    } finally {
      inFlight = false
    }
  }
  void tick()
  const timer = setInterval(() => void tick(), POLL_MS)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

// --- Writes (all idempotent where the server supports it) ----------------------

export async function registerVehicleLive(
  data: {
    licensePlate: string
    driverName: string
    cargoType: string
    expectedDestination: string
  },
  key: string,
): Promise<void> {
  await apiFetch('/queue/', {
    method: 'POST',
    body: {
      facility: facilityId,
      reg_number: data.licensePlate.toUpperCase(),
      driver_name: data.driverName ?? '',
      cargo_type: data.cargoType ?? '',
      expected_destination: data.expectedDestination ?? '',
      idempotency_key: `q-${key}`,
    },
  })
}

export async function assignDockLive(queueEntryId: string, dockId: string): Promise<void> {
  await apiFetch(`/docks/${encodeURIComponent(String(dockId))}/assign/`, {
    method: 'POST',
    body: { queue_entry: queueEntryId },
  })
}

export async function submitComplianceLive(input: {
  queueEntryId: string
  weights: [number, number, number]
  limits?: [number, number, number]
  routeType?: string
  vehicleType?: string
  totalWeight: number
  gvmRating: number
  supervisorId: string
  checklistResults?: Record<string, boolean>
  key: string
}): Promise<'PASS' | 'FAIL'> {
  // Server resolves S.I. limits from tenant config and returns the final
  // verdict (SAD §9). The local validateLoad copy stays demo-only.
  const data = await apiFetch<{ check: { overall_status: 'PASS' | 'FAIL' } }>(
    '/compliance/',
    {
      method: 'POST',
      body: {
        queue_entry: input.queueEntryId,
        axle_weights: input.weights,
        total_weight: input.totalWeight,
        gvm_rating: input.gvmRating,
        route_type: input.routeType ?? 'DEFAULT',
        vehicle_type: input.vehicleType,
        client_key: input.key,
        checklist_results: input.checklistResults ?? {},
      },
    },
  )
  return data.check.overall_status === 'PASS' ? 'PASS' : 'FAIL'
}

export async function acknowledgeAlertLive(alertId: string, _by = ''): Promise<void> {
  await apiFetch(`/alerts/${encodeURIComponent(alertId)}/ack/`, { method: 'POST' })
}

export interface ChecklistItem {
  itemId: string
  label: string
  mandatory: boolean
}

export interface ComplianceConfig {
  limits: number[]
  checklist: ChecklistItem[]
}

const FALLBACK_CHECKLIST: ChecklistItem[] = [
  { itemId: 'driver-license', label: 'Driver license verified', mandatory: true },
  { itemId: 'vehicle-reg', label: 'Vehicle registration verified', mandatory: true },
  { itemId: 'cargo-manifest', label: 'Cargo manifest attached', mandatory: true },
  { itemId: 'weight-cert', label: 'Weight certificate recorded', mandatory: true },
  { itemId: 'axle-calc', label: 'Axle load calculation within limits', mandatory: true },
]

/** Resolve axle limits for a vehicle type with DEFAULT fallback (S.I. tables).
 * Phase 3: route-aware. `route` is optional for backwards compat. callers
 * that only pass vehicleType keep the legacy global behaviour. */
export function resolveAxleLimits(
  siTables: Record<string, number[]> | undefined,
  axleLimits: { default?: number[] } | undefined,
  vehicleType: string,
  route?: string,
  siTablesByRoute?: Record<string, Record<string, number[]>>,
): number[] {
  const remote: SiRemoteConfig = { siTables, axleLimits, siTablesByRoute }
  return resolveSiLimits(route ?? 'DEFAULT', vehicleType, remote)
}

export async function getComplianceConfig(
  vehicleType = 'DEFAULT',
  route = 'DEFAULT',
): Promise<ComplianceConfig> {
  const fallback: ComplianceConfig = {
    limits: resolveSiLimits(route, vehicleType, undefined),
    checklist: useSession.getState().workspace?.configuration?.content.workflow.mandatory_checks.map(itemId => ({
      itemId, label: FALLBACK_CHECKLIST.find(item => item.itemId === itemId)?.label ?? itemId.replace(/-/g,' '), mandatory: true,
    })) ?? FALLBACK_CHECKLIST,
  }
  if (!isRealLive()) return fallback
  try {
    const data = await apiFetch<{
      config?: { route_type: string; vehicle_type: string; axle_limits: number[] }[]
    }>('/compliance/config/')
    const siTablesByRoute: Record<string, Record<string, number[]>> = {}
    for (const row of data.config ?? []) {
      const r = String(row.route_type).toUpperCase()
      const v = String(row.vehicle_type).toUpperCase()
      ;(siTablesByRoute[r] ??= {})[v] = row.axle_limits
    }
    const remote: SiRemoteConfig = { siTablesByRoute }
    return { limits: resolveSiLimits(route, vehicleType, remote), checklist: fallback.checklist }
  } catch {
    return fallback
  }
}

/** Secondary-approver rule, stable-ID form (canonical. Both paths unify here). */
export function isSelfApprovalById(
  requestedById: string | null | undefined,
  approverId: string,
): boolean {
  const r = (requestedById ?? '').trim()
  return r.length > 0 && r === approverId.trim()
}

/** Legacy display-name form (pre-ID override docs). Kept for grandfathered
 * records only. new writes always carry stable IDs. */
export function isSelfApproval(
  requestedBy: string | null | undefined,
  approver: string,
): boolean {
  const r = (requestedBy ?? '').trim()
  return r.length > 0 && r === approver.trim()
}

/** The backend keys overrides on the compliance CHECK, the screens key on the
 * queue ENTRY. resolve entry -> latest check in the required status. */
async function resolveCheckId(
  entryId: string,
  wantStatus: 'QUARANTINED' | 'PENDING_OVERRIDE',
): Promise<string> {
  const data = await apiFetch<{ checks?: Record<string, unknown>[] }>(
    `/compliance/?${facQS()}`,
  )
  const match = (data.checks ?? [])
    .filter(
      (c) => String(c.queue_entry_id) === entryId && String(c.status) === wantStatus,
    )
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0]
  if (!match) {
    throw new Error(
      wantStatus === 'QUARANTINED'
        ? 'No quarantined check found for this entry. run the compliance check first.'
        : 'No override pending for this entry.',
    )
  }
  return String(match.id)
}

export async function requestOverrideLive(
  queueEntryId: string,
  reason: string,
  _userId = '',
  _displayName = '',
): Promise<void> {
  if (!reason.trim()) throw new Error('Override reason is required.')
  const checkId = await resolveCheckId(queueEntryId, 'QUARANTINED')
  await apiFetch(`/compliance/${checkId}/override-request/`, {
    method: 'POST',
    body: { reason: reason.trim() },
  })
}

export async function approveOverrideLive(
  queueEntryId: string,
  approved: boolean,
  _userId = '',
  notes = '',
): Promise<void> {
  const checkId = await resolveCheckId(queueEntryId, 'PENDING_OVERRIDE')
  await apiFetch(`/compliance/${checkId}/override-approve/`, {
    method: 'POST',
    body: {
      reason: notes.trim() || (approved ? 'Approved' : 'Rejected'),
      approved,
    },
  })
}

export async function releaseVehicleLive(queueEntryId: string): Promise<void> {
  await apiFetch(`/queue/${encodeURIComponent(queueEntryId)}/release/`, {
    method: 'POST',
  })
}

// --- Reporting (FR-A4) ---------------------------------------------------------

export function toMillis(ts: unknown): number | null {
  if (ts == null) return null
  if (typeof ts === 'number') return ts
  if (typeof ts === 'string') {
    const t = Date.parse(ts)
    return Number.isNaN(t) ? null : t
  }
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    try {
      return (ts as { toDate: () => Date }).toDate().getTime()
    } catch {
      return null
    }
  }
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
    return (ts as { seconds: number }).seconds * 1000
  }
  return null
}

export interface TurnaroundStats {
  total: number
  byStatus: Record<string, number>
  avgWaitMinutes: number | null
  avgTurnaroundMinutes: number | null
  overdueCount: number
}

/** Pure stats over queue rows. unit-tested, feeds Reports + CSV export. */
export function computeTurnaroundStats(rows: LiveRow[], now = Date.now(), overdueMinutes = 60): TurnaroundStats {
  const byStatus: Record<string, number> = {}
  const waits: number[] = []
  const turns: number[] = []
  let overdueCount = 0
  for (const r of rows) {
    const status = String(r.status ?? 'UNKNOWN')
    byStatus[status] = (byStatus[status] ?? 0) + 1
    const entered = toMillis(r.entryTimestamp ?? r.createdAt)
    const exited = toMillis(r.exitTimestamp ?? (r.milestoneSemantics !== 'SEPARATE_V1' && (status === 'RELEASED' || status === 'COMPLETED') ? r.updatedAt : null))
    if (entered != null) {
      const end = exited ?? now
      if (end >= entered) {
        const mins = (end - entered) / 60000
        if (exited != null) turns.push(mins)
        else {
          waits.push(mins)
          if (mins > overdueMinutes) overdueCount += 1
        }
      }
    }
  }
  const avg = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length)
  return { total: rows.length, byStatus, avgWaitMinutes: avg(waits), avgTurnaroundMinutes: avg(turns), overdueCount }
}

export function queueToCsv(rows: LiveRow[]): string {
  const head = 'id,licensePlate,driver,cargoType,expectedDestination,status,entryTimestamp,exitTimestamp,milestoneSemantics,releaseAuthorizedAt,dockVacatedAt'
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const fmt = (ts: unknown) => {
    const ms = toMillis(ts)
    return ms == null ? '' : new Date(ms).toISOString()
  }
  const lines = rows.map((r) =>
    [r.id, r.licensePlate, r.driverName ?? r.driverId, r.cargoType, r.expectedDestination, r.status, fmt(r.entryTimestamp), fmt(r.exitTimestamp), r.milestoneSemantics, fmt(r.releaseAuthorizedAt), fmt(r.dockVacatedAt)].map(esc).join(','),
  )
  return [head, ...lines].join('\n')
}

// --- Offline replay ------------------------------------------------------------

async function replayOne(action: PendingAction): Promise<void> {
  switch (action.actionType) {
    case 'queue.create': {
      const p = action.payload as {
        licensePlate: string
        driverName: string
        cargoType: string
        expectedDestination: string
      }
      await registerVehicleLive(p, action.id)
      break
    }
    case 'compliance.submit': {
      const p = action.payload as {
        queueEntryId: string
        weights: [number, number, number]
        limits?: [number, number, number]
        routeType?: string
        vehicleType?: string
        totalWeight: number
        gvmRating: number
        supervisorId: string
        checklistResults?: Record<string, boolean>
      }
      await submitComplianceLive({ ...p, key: action.id })
      break
    }
    default:
      throw new Error(`Unknown action type: ${action.actionType}`)
  }
}

/** Replay queued offline actions in order. Returns { done, failed }. */
let activeReplay: Promise<{ done: number; failed: number }> | null = null

export function flushPendingActions(): Promise<{ done: number; failed: number }> {
  if (activeReplay) return activeReplay
  activeReplay = replayPendingActions().finally(() => { activeReplay = null })
  return activeReplay
}

async function replayPendingActions(): Promise<{ done: number; failed: number }> {
  if (!isRealLive() || typeof navigator !== 'undefined' && !navigator.onLine) return { done: 0, failed: 0 }
  let done = 0
  let failed = 0
  const actorId = useSession.getState().userId
  const token = getToken()
  for (const action of await listPendingActions()) {
    if (useSession.getState().userId !== actorId || getToken() !== token || !isRealLive()) break
    if (action.actorId !== actorId || action.facilityId !== facilityId || action.apiBase !== apiBase
        || action.state === 'BLOCKED' || (action.nextAttemptAt ?? 0) > Date.now()) continue
    try {
      await replayOne(action)
      await removePendingAction(action.id)
      done += 1
    } catch (err) {
      await recordActionFailure(action.id, (err as Error).message,
        err instanceof ApiError && err.status >= 400 && err.status < 500)
      failed += 1
    }
  }
  return { done, failed }
}


export async function switchRoleLive(role: LiveRole): Promise<SessionUser> {
  const data = await apiFetch<{ user: { id: number; username: string; role: string; base_role: string } }>(
    '/auth/switch-role/', { method: 'POST', body: { role } },
  )
  return sessionFrom(data.user)
}
