// Offline-first queue (SAD §3 / Spec §8): Dexie/IndexedDB-backed pending actions.
// Primary store is IndexedDB `OperationalLocalDB`; legacy localStorage key is
// migrated once on first open so tablets keep queued work across the upgrade.

import Dexie, { type Table } from 'dexie'
import { useSession, isPracticeSession } from '../../store/session'
import { apiBase, facilityId } from '../api'

export interface PendingAction {
  id: string // client-generated idempotency key
  actionType: string
  payload: Record<string, unknown>
  timestamp: number
  retryCount: number
  lastError?: string
  actorId?: string
  facilityId?: string
  apiBase?: string
  state?: 'PENDING' | 'BLOCKED'
  nextAttemptAt?: number
}

export interface GateInspection {
  id?: number
  vehicleReg: string
  haulierName: string
  axleConfiguration: string
  measuredAxleWeightKg: number
  maxPermissibleKg: number
  status: 'passed' | 'quarantined' | 'pending'
  quarantineReason?: string
  inspectorId: string
  timestamp: string
  synced: boolean
}

export interface SyncQueueItem {
  id?: number
  action: 'CREATE_INSPECTION' | 'UPDATE_QUEUE' | 'REBALANCE_LOAD'
  payload: unknown
  timestamp: string
  retryCount: number
}

const LEGACY_KEY = 'radbit_bak_pendingActions_v1'
const MAX_RETRIES = 5

export class LocalAppDatabase extends Dexie {
  pendingActions!: Table<PendingAction, string>
  inspections!: Table<GateInspection, number>
  syncQueue!: Table<SyncQueueItem, number>

  constructor() {
    super('OperationalLocalDB')
    this.version(1).stores({
      pendingActions: 'id, actionType, timestamp',
      inspections: '++id, vehicleReg, status, timestamp, synced',
      syncQueue: '++id, action, timestamp',
    })
    this.version(2).stores({
      pendingActions: 'id, actionType, timestamp, actorId, facilityId, state',
      inspections: '++id, vehicleReg, status, timestamp, synced',
      syncQueue: '++id, action, timestamp',
    }).upgrade(async (tx) => {
      await tx.table('pendingActions').toCollection().modify((action: PendingAction) => {
        if (!action.actorId) {
          action.state = 'BLOCKED'
          action.lastError = 'Legacy action has no owning session; supervisor review required'
        }
      })
    })
  }
}

export const db = new LocalAppDatabase()

function legacyRead(): PendingAction[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(LEGACY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PendingAction[]
    return Array.isArray(parsed) ? parsed.sort((a, b) => a.timestamp - b.timestamp) : []
  } catch {
    return []
  }
}

let migrationDone = false

/** Test-only reset for the once-per-session legacy migration flag. */
export function __resetOfflineMigration(): void {
  migrationDone = false
}

async function migrateLegacyOnce(): Promise<void> {
  if (migrationDone) return
  try {
    const legacy = legacyRead()
    if (legacy.length === 0) return
    const existing = await db.pendingActions.toCollection().primaryKeys()
    const seen = new Set(existing)
    const fresh = legacy.filter((a) => a?.id && !seen.has(a.id)).map((a) => (
      a.actorId ? a : { ...a, state: 'BLOCKED' as const,
        lastError: 'Legacy action has no owning session; supervisor review required' }
    ))
    if (fresh.length > 0) await db.pendingActions.bulkAdd(fresh)
    try {
      localStorage.removeItem(LEGACY_KEY)
    } catch {
      // Non-blocking — IndexedDB is now the source of truth.
    }
    migrationDone = true
  } catch {
    // IndexedDB unavailable (private mode); callers fall back per-op.
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function enqueueOfflineAction(
  actionType: string,
  payload: Record<string, unknown>,
): Promise<PendingAction> {
  const actorId = useSession.getState().userId
  const owned = actorId != null && !isPracticeSession(actorId) && apiBase.length > 0
  const action: PendingAction = { id: newId(), actionType, payload, timestamp: Date.now(), retryCount: 0,
    actorId: owned ? actorId : undefined, facilityId: owned ? facilityId : undefined,
    apiBase: owned ? apiBase : undefined, state: owned ? 'PENDING' : 'BLOCKED' }
  try {
    await migrateLegacyOnce()
    await db.pendingActions.add(action)
  } catch {
    // Fallback: append to legacy key so work is never lost when IndexedDB is blocked.
    try {
      const all = legacyRead()
      all.push(action)
      localStorage.setItem(LEGACY_KEY, JSON.stringify(all))
    } catch {
      throw new Error('Inspection was not saved: local storage unavailable. Keep a manual record and retry.')
    }
  }
  return action
}

export async function listPendingActions(): Promise<PendingAction[]> {
  try {
    await migrateLegacyOnce()
    const stored = await db.pendingActions.orderBy('timestamp').toArray()
    const ids = new Set(stored.map((a) => a.id))
    return [...stored, ...legacyRead().filter((a) => !ids.has(a.id))].sort((a, b) => a.timestamp - b.timestamp)
  } catch {
    return legacyRead()
  }
}

export async function removePendingAction(id: string): Promise<void> {
  try {
    await db.pendingActions.delete(id)
  } catch {
    // Fall through to legacy cleanup.
  }
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (raw) localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyRead().filter((a) => a.id !== id)))
  } catch {
    // Ignore.
  }
}

export async function recordActionFailure(id: string, error: string, permanent = false): Promise<PendingAction | null> {
  try {
    await migrateLegacyOnce()
    const found = await db.pendingActions.get(id)
    if (!found) return null
    found.retryCount += 1
    found.lastError = error
    found.state = permanent || found.retryCount >= MAX_RETRIES ? 'BLOCKED' : 'PENDING'
    found.nextAttemptAt = Date.now() + Math.min(300000, 5000 * 2 ** (found.retryCount - 1))
    await db.pendingActions.put(found)
    return found
  } catch {
    const all = legacyRead()
    const found = all.find((a) => a.id === id)
    if (!found) return null
    found.retryCount += 1
    found.lastError = error
    found.state = permanent || found.retryCount >= MAX_RETRIES ? 'BLOCKED' : 'PENDING'
    found.nextAttemptAt = Date.now() + Math.min(300000, 5000 * 2 ** (found.retryCount - 1))
    try {
      localStorage.setItem(LEGACY_KEY, JSON.stringify(all))
    } catch {
      // Ignore.
    }
    return found
  }
}

export async function pendingActionCount(): Promise<number> {
  return (await listPendingActions()).length
}

/** Synchronous legacy shim — deprecated, kept for header badge initial paint only. */
export function pendingActionCountSyncInitial(): number {
  return legacyRead().length
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}
