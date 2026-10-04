/**
 * Live Firestore data layer (MVP slice). Every export degrades gracefully:
 * - No Firebase config  -> demo mode, screens use local seeds.
 * - Configured + offline -> writes join the offline queue, replayed on reconnect.
 * - Configured + online  -> real-time subscriptions + transactional writes.
 */
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth, db, facilityId, isLive } from './firebase'
import { isRealLive } from './liveGate'
import {
  listPendingActions,
  recordActionFailure,
  removePendingAction,
  type PendingAction,
} from './offline/db'
import { validateLoad } from './validation/compliance'
import { resolveSiLimits, type SiRemoteConfig } from './validation/siTables'

export { isLive }
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

// --- Auth (FR-C1) --------------------------------------------------------------

export async function signInLive(
  email: string,
  password: string,
): Promise<{ uid: string; role: LiveRole; displayName: string }> {
  if (!auth) throw new Error('Sign-in not connected (practice mode)')
  const cred = await signInWithEmailAndPassword(auth, email, password)
  const token = await cred.user.getIdTokenResult()
  const role = token.claims.role as string | undefined
  if (!role || !(ROLES as readonly string[]).includes(role)) {
    await signOut(auth)
    throw new Error('This account has no job assigned — ask your supervisor to set up your account.')
  }
  return {
    uid: cred.user.uid,
    role: role as LiveRole,
    displayName: cred.user.displayName ?? cred.user.email ?? 'Trucki user',
  }
}

export async function signOutLive(): Promise<void> {
  if (auth) await signOut(auth)
}

// --- One-time staging seed (ADMIN only, idempotent merges) -----------------------

export async function seedDemoFacility(): Promise<void> {
  await setDoc(
    doc(collection(db!, 'facilities'), facilityId),
    {
      name: 'Demo Yard',
      timezone: 'Africa/Harare',
      operatingHours: { open: '06:00', close: '22:00' },
      dockCount: 4,
      equipmentFleetSize: 3,
      waitThresholdMinutes: 60,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
  for (const d of [
    { id: 'D1', name: 'Dock 1', capacity: 24000, status: 'OCCUPIED' },
    { id: 'D2', name: 'Dock 2', capacity: 24000, status: 'AVAILABLE' },
    { id: 'D3', name: 'Dock 3', capacity: 18000, status: 'AVAILABLE' },
    { id: 'D4', name: 'Dock 4', capacity: 24000, status: 'MAINTENANCE' },
  ]) {
    await setDoc(doc(col('docks'), d.id), { ...d, currentAssignment: null, createdAt: serverTimestamp() }, { merge: true })
  }
  for (const e of [
    { id: 'FL-01', type: 'FORKLIFT', status: 'AVAILABLE' },
    { id: 'FL-02', type: 'FORKLIFT', status: 'IN_USE' },
    { id: 'TR-01', type: 'TRAILER', status: 'AVAILABLE' },
  ]) {
    await setDoc(doc(col('equipment'), e.id), { ...e, currentAssignment: null, createdAt: serverTimestamp() }, { merge: true })
  }
  await setDoc(
    doc(col('complianceConfig'), 'default'),
    {
      axleLimits: { default: [8000, 9000, 9000] },
      // S.I. 129/2015 tables per vehicle type (pilot values — BAK to confirm with VID schedule).
      siTables: {
        DEFAULT: [8000, 9000, 9000],
        FLATBED: [8000, 9000, 9000],
        TANKER: [8000, 8000, 9000],
        REFRIGERATED: [7500, 9000, 9000],
        CONTAINER: [8000, 9000, 9000],
        DRY_VAN: [8000, 9000, 9000],
      },
      // Phase 3: corridor-scoped overrides. Same pilot values until BAK/VID
      // confirms per-corridor schedules — edit in Firestore, no redeploy.
      siTablesByRoute: {
        BEITBRIDGE: {
          DEFAULT: [8000, 9000, 9000],
          FLATBED: [8000, 9000, 9000],
          TANKER: [8000, 8000, 9000],
          REFRIGERATED: [7500, 9000, 9000],
          CONTAINER: [8000, 9000, 9000],
          DRY_VAN: [8000, 9000, 9000],
        },
        CHIRUNDU: {
          DEFAULT: [8000, 9000, 9000],
          FLATBED: [8000, 9000, 9000],
          TANKER: [8000, 8000, 9000],
          REFRIGERATED: [7500, 9000, 9000],
          CONTAINER: [8000, 9000, 9000],
          DRY_VAN: [8000, 9000, 9000],
        },
        FORBES: {
          DEFAULT: [8000, 9000, 9000],
          FLATBED: [8000, 9000, 9000],
          TANKER: [8000, 8000, 9000],
          REFRIGERATED: [7500, 9000, 9000],
          CONTAINER: [8000, 9000, 9000],
          DRY_VAN: [8000, 9000, 9000],
        },
        HARARE_LOCAL: {
          DEFAULT: [8000, 9000, 9000],
          FLATBED: [8000, 9000, 9000],
          TANKER: [8000, 8000, 9000],
          REFRIGERATED: [7500, 9000, 9000],
          CONTAINER: [8000, 9000, 9000],
          DRY_VAN: [8000, 9000, 9000],
        },
      },
      requiredChecklistItems: [
        { itemId: 'driver-license', label: 'Driver license verified', mandatory: true },
        { itemId: 'vehicle-reg', label: 'Vehicle registration verified', mandatory: true },
        { itemId: 'cargo-manifest', label: 'Cargo manifest attached', mandatory: true },
        { itemId: 'weight-cert', label: 'Weight certificate recorded', mandatory: true },
        { itemId: 'axle-calc', label: 'Axle load calculation within limits', mandatory: true },
      ],
      overridePolicy: { requiresSecondaryApproval: true, autoEscalateAfterMinutes: 30 },
    },
    { merge: true },
  )
  // the gatekeeper walkthrough shift — same 8-truck morning as demoData.ts.
  // Idempotent merges; safe to re-run. Skipped silently when docs exist?
  // No — merge overwrites status, which is exactly what a re-demo wants.
  const shiftQueue = [
    { id: 'q-seed-1', licensePlate: 'AEH 4521', driverName: 'T. Moyo', cargoType: 'Container', expectedDestination: 'Beitbridge', status: 'QUEUED' },
    { id: 'q-seed-2', licensePlate: 'AGX 9033', driverName: 'S. Ndlovu', cargoType: 'Dry van', expectedDestination: 'Forbes', status: 'ASSIGNED', assignedDockId: 'D1' },
    { id: 'q-seed-3', licensePlate: 'AFM 1187', driverName: 'K. Sibanda', cargoType: 'Tanker', expectedDestination: 'Chirundu', status: 'QUARANTINED' },
    { id: 'q-seed-4', licensePlate: 'ABZ 9901', driverName: 'R. Dube', cargoType: 'Container', expectedDestination: 'Beitbridge', status: 'QUEUED' },
    { id: 'q-seed-6', licensePlate: 'ADP 3357', driverName: 'J. Banda', cargoType: 'Flatbed', expectedDestination: 'Chirundu', status: 'PENDING_OVERRIDE' },
    { id: 'q-seed-7', licensePlate: 'AEW 7712', driverName: 'M. Hove', cargoType: 'Dry van', expectedDestination: 'Forbes', status: 'OVERRIDE_APPROVED' },
    { id: 'q-seed-8', licensePlate: 'AFX 6640', driverName: 'D. Mutasa', cargoType: 'Container', expectedDestination: 'Beitbridge', status: 'QUEUED' },
  ]
  for (const q of shiftQueue) {
    await setDoc(
      doc(col('queue'), q.id),
      { ...q, entryTimestamp: serverTimestamp(), createdAt: serverTimestamp() },
      { merge: true },
    )
  }
  const shiftAlerts = [
    { id: 'quar-q-seed-3', type: 'COMPLIANCE_FAILURE', severity: 'CRITICAL', status: 'ACTIVE', relatedEntityType: 'queueEntry', relatedEntityId: 'q-seed-3', message: 'AFM 1187 quarantined: Axle 2 overloaded by 1,400kg. Rebalancing or override required.' },
    { id: 'wait-q-seed-4', type: 'EXCESSIVE_WAIT', severity: 'HIGH', status: 'ACTIVE', relatedEntityType: 'queueEntry', relatedEntityId: 'q-seed-4', message: 'ABZ 9901 waiting 74m (exceeds 60m threshold).' },
  ]
  for (const a of shiftAlerts) {
    await setDoc(
      doc(col('alerts'), a.id),
      { ...a, escalationLevel: 0, triggeredAt: serverTimestamp(), createdAt: serverTimestamp() },
      { merge: true },
    )
  }
}

function col(name: string) {
  if (!db) throw new Error('Yard system not connected')
  return collection(db, `facilities/${facilityId}/${name}`)
}

function toRows(snapshot: { docs: Array<{ id: string; data: () => DocumentData }> }): LiveRow[] {
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export function subscribe(
  name: 'queue' | 'docks' | 'alerts' | 'auditLogs' | 'equipment',
  cb: (rows: LiveRow[]) => void,
  max = 100,
): Unsubscribe | null {
  if (!isRealLive()) return null
  const q =
    name === 'queue' || name === 'auditLogs'
      ? query(col(name), orderBy(name === 'queue' ? 'entryTimestamp' : 'timestamp', 'desc'), limit(max))
      : query(col(name), limit(max))
  return onSnapshot(
    q,
    (snap) => cb(toRows(snap)),
    (err) => {
      // Never leave Firestore denials uncaught: almost always signed-out state
      // or a token minted before role claims were set — recover via sign out/in.
      console.warn(
        `[live] ${name} listener denied (${err.code}). Sign out and sign back in to refresh role claims; check ADMIN set {role, facilities} on the account.`,
      )
    },
  )
}

// --- Writes (all idempotent: callers pass the offline action ID as doc ID) ----

export async function registerVehicleLive(
  data: { licensePlate: string; driverName: string; cargoType: string; expectedDestination: string },
  key: string,
): Promise<void> {
  await setDoc(
    doc(col('queue'), `q-${key}`),
    {
      ...data,
      licensePlate: data.licensePlate.toUpperCase(),
      status: 'QUEUED',
      entryTimestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function assignDockLive(queueEntryId: string, dockId: string): Promise<void> {
  if (!db) throw new Error('Firestore not configured (demo mode)')
  const qRef = doc(col('queue'), queueEntryId)
  const dRef = doc(col('docks'), dockId)
  await runTransaction(db, async (tx) => {
    const dock = await tx.get(dRef)
    if (!dock.exists() || dock.get('status') !== 'AVAILABLE') {
      throw new Error('Dock is not available')
    }
    tx.update(qRef, { status: 'ASSIGNED', assignedDockId: dockId, updatedAt: serverTimestamp() })
    tx.update(dRef, { status: 'OCCUPIED', currentAssignment: queueEntryId })
  })
}

export async function submitComplianceLive(input: {
  queueEntryId: string
  weights: [number, number, number]
  limits?: [number, number, number]
  routeType?: string
  totalWeight: number
  gvmRating: number
  supervisorId: string
  key: string
}): Promise<'PASS' | 'FAIL'> {
  const result = validateLoad({
    axleConfiguration: '2-4-2',
    measuredWeights: [...input.weights],
    limits: [...(input.limits ?? [8000, 9000, 9000])],
    totalWeight: input.totalWeight,
    gvmRating: input.gvmRating,
  })
  const checkId = `c-${input.key}`
  await setDoc(
    doc(col('complianceChecks'), checkId),
    {
      queueEntryId: input.queueEntryId,
      routeType: input.routeType ?? 'DEFAULT',
      axleLoads: input.weights,
      totalWeight: input.totalWeight,
      gvmRating: input.gvmRating,
      overallStatus: result.overallStatus,
      violations: result.violations,
      supervisorId: input.supervisorId,
      completedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  )
  if (result.overallStatus === 'FAIL') {
    await updateDoc(doc(col('queue'), input.queueEntryId), {
      status: 'QUARANTINED',
      updatedAt: serverTimestamp(),
    })
    // Same deterministic ID the Cloud Function writes — set-merge, no duplicates.
    await setDoc(
      doc(col('alerts'), `quar-${input.queueEntryId}`),
      {
        type: 'COMPLIANCE_FAILURE',
        severity: 'CRITICAL',
        relatedEntityType: 'queueEntry',
        relatedEntityId: input.queueEntryId,
        message: `Vehicle quarantined: ${result.violations.join('; ')}`,
        status: 'ACTIVE',
        escalationLevel: 0,
        triggeredAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true },
    )
  }
  const outcome: 'PASS' | 'FAIL' = result.overallStatus === 'PASS' ? 'PASS' : 'FAIL'
  return outcome
}

export async function acknowledgeAlertLive(alertId: string, by: string): Promise<void> {
  await updateDoc(doc(col('alerts'), alertId), {
    status: 'ACKNOWLEDGED',
    acknowledgedBy: by,
    acknowledgedAt: serverTimestamp(),
  })
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

/** Resolve axle limits for a vehicle type with DEFAULT fallback (S.I. tables).
 * Phase 3: route-aware. `route` is optional for backwards compat — callers
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

export async function getComplianceConfig(vehicleType = 'DEFAULT', route = 'DEFAULT'): Promise<ComplianceConfig> {
  const fallback: ComplianceConfig = {
    limits: resolveSiLimits(route, vehicleType, undefined),
    checklist: [
      { itemId: 'driver-license', label: 'Driver license verified', mandatory: true },
      { itemId: 'vehicle-reg', label: 'Vehicle registration verified', mandatory: true },
      { itemId: 'cargo-manifest', label: 'Cargo manifest attached', mandatory: true },
      { itemId: 'weight-cert', label: 'Weight certificate recorded', mandatory: true },
      { itemId: 'axle-calc', label: 'Axle load calculation within limits', mandatory: true },
    ],
  }
  if (!isRealLive()) return fallback
  try {
    const { getDoc } = await import('firebase/firestore')
    const snap = await getDoc(doc(col('complianceConfig'), 'default'))
    if (!snap.exists()) return fallback
    const data = snap.data() as {
      axleLimits?: { default?: number[] }
      siTables?: Record<string, number[]>
      siTablesByRoute?: Record<string, Record<string, number[]>>
      requiredChecklistItems?: ChecklistItem[]
    }
    return {
      limits: resolveSiLimits(route, vehicleType, data),
      checklist: data.requiredChecklistItems?.length ? data.requiredChecklistItems : fallback.checklist,
    }
  } catch {
    return fallback
  }
}

/** Secondary-approver rule, stable-ID form (canonical — both paths unify here).
 * PowerSync compares `inspector_id` vs `authorizerId`; Firestore compares
 * `overrideRequest.requestedById` vs approver userId. */
export function isSelfApprovalById(
  requestedById: string | null | undefined,
  approverId: string,
): boolean {
  const r = (requestedById ?? '').trim()
  return r.length > 0 && r === approverId.trim()
}

/** Legacy display-name form (pre-ID override docs). Kept for grandfathered
 * records only — new writes always carry `requestedById`. */
export function isSelfApproval(
  requestedBy: string | null | undefined,
  approver: string,
): boolean {
  const r = (requestedBy ?? '').trim()
  return r.length > 0 && r === approver.trim()
}

export async function requestOverrideLive(queueEntryId: string, reason: string, userId: string, displayName = userId): Promise<void> {
  if (!reason.trim()) throw new Error('Override reason is required.')
  await updateDoc(doc(col('queue'), queueEntryId), {
    status: 'PENDING_OVERRIDE',
    overrideRequest: { reason: reason.trim(), requestedBy: displayName, requestedById: userId, requestedAt: serverTimestamp() },
    updatedAt: serverTimestamp(),
  })
}

export async function approveOverrideLive(queueEntryId: string, approved: boolean, userId: string, notes = ''): Promise<void> {
  // Secondary-approver enforcement on stable user IDs (parity with
  // approveOverridePS): the requester cannot approve their own override.
  const snap = await getDoc(doc(col('queue'), queueEntryId))
  const req = snap.exists()
    ? (snap.data().overrideRequest as { requestedBy?: string; requestedById?: string } | undefined)
    : undefined
  if (isSelfApprovalById(req?.requestedById, userId)) {
    throw new Error('Secondary approval violation: approver cannot be the override requester.')
  }
  await updateDoc(doc(col('queue'), queueEntryId), {
    status: approved ? 'OVERRIDE_APPROVED' : 'QUARANTINED',
    overrideDecision: { approved, by: userId, notes, decidedAt: serverTimestamp() },
    updatedAt: serverTimestamp(),
  })
}

export async function releaseVehicleLive(queueEntryId: string): Promise<void> {
  await updateDoc(doc(col('queue'), queueEntryId), {
    status: 'RELEASED',
    exitTimestamp: serverTimestamp(),
    updatedAt: serverTimestamp(),
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

/** Pure stats over queue rows — unit-tested, feeds Reports + CSV export. */
export function computeTurnaroundStats(rows: LiveRow[], now = Date.now(), overdueMinutes = 60): TurnaroundStats {
  const byStatus: Record<string, number> = {}
  const waits: number[] = []
  const turns: number[] = []
  let overdueCount = 0
  for (const r of rows) {
    const status = String(r.status ?? 'UNKNOWN')
    byStatus[status] = (byStatus[status] ?? 0) + 1
    const entered = toMillis(r.entryTimestamp ?? r.createdAt)
    const exited = toMillis(r.exitTimestamp ?? (status === 'RELEASED' || status === 'COMPLETED' ? r.updatedAt : null))
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
  const head = 'id,licensePlate,driver,cargoType,expectedDestination,status,entryTimestamp,exitTimestamp'
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const fmt = (ts: unknown) => {
    const ms = toMillis(ts)
    return ms == null ? '' : new Date(ms).toISOString()
  }
  const lines = rows.map((r) =>
    [r.id, r.licensePlate, r.driverName ?? r.driverId, r.cargoType, r.expectedDestination, r.status, fmt(r.entryTimestamp), fmt(r.exitTimestamp)].map(esc).join(','),
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
        routeType?: string
        totalWeight: number
        gvmRating: number
        supervisorId: string
      }
      await submitComplianceLive({ ...p, key: action.id })
      break
    }
    default:
      throw new Error(`Unknown action type: ${action.actionType}`)
  }
}

/** Replay queued offline actions in order. Returns { done, failed }. */
export async function flushPendingActions(): Promise<{ done: number; failed: number }> {
  if (!isRealLive() || typeof navigator !== 'undefined' && !navigator.onLine) return { done: 0, failed: 0 }
  let done = 0
  let failed = 0
  for (const action of await listPendingActions()) {
    try {
      await replayOne(action)
      await removePendingAction(action.id)
      done += 1
    } catch (err) {
      await recordActionFailure(action.id, (err as Error).message)
      failed += 1
    }
  }
  return { done, failed }
}
