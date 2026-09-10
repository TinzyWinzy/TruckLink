// Self-hosted Firestore relay (replaces Cloud Functions — no Blaze plan).
//
// Why this exists: deploying Cloud Functions requires the Blaze billing plan,
// but Firestore itself + the Admin SDK work fine on the free Spark plan from
// any host. This process runs on our own infra (same VPS as the sync service),
// listens to the same collections the Functions triggers watched, and performs
// the same actions: SHA-256 audit appends, deterministic quarantine alerts,
// and quarantine-event fan-out into RabbitMQ (10m/30m escalation timers).
//
// Run: `npm run relay` (requires FIREBASE_PROJECT_ID + FIREBASE_SERVICE_ACCOUNT_JSON).
// functions/ stays untouched as fallback; when this relay is live, set
// VITE_CLIENT_AUDIT_ENABLED=false so the client stops double-writing audit.

import { decideQueueChange, facilityFromPath, quarantineAlertId, quarantineAlertPayload } from './decide.js'
import { hashAuditEntry } from '../workers/auditVerify.js'
import { getPublisher } from '../events/publisher.js'
import { EVENTS_EXCHANGE, ROUTING_KEYS } from '../events/topology.js'

interface FirestoreDoc {
  ref: { path: string; parent: { parent: { id: string } | null } }
  data(): Record<string, unknown> | undefined
}

interface FirestoreDb {
  collectionGroup(name: string): {
    onSnapshot(cb: (snap: { docChanges(): Array<{ type: string; doc: FirestoreDoc }> }) => void | Promise<void>): void
  }
  collection(path: string): {
    orderBy(field: string, dir: string): { limit(n: number): unknown }
    doc(id?: string): { set(data: Record<string, unknown>, opts?: Record<string, unknown>): Promise<void>; get(): Promise<{ empty: boolean; docs: Array<{ get(f: string): unknown }> }> }
  }
  runTransaction(fn: (tx: { get(q: unknown): Promise<{ empty: boolean; docs: Array<{ get(f: string): unknown }> }>; set(ref: unknown, data: Record<string, unknown>): void }) => Promise<void>): Promise<void>
}

function auditSalt(facilityId: string): string {
  return process.env[`AUDIT_SALT_${facilityId}`] ?? process.env.AUDIT_SALT ?? 'pilot-salt-rotate-me'
}

async function appendAuditLog(db: FirestoreDb, facilityId: string, entry: Record<string, unknown>): Promise<void> {
  const col = db.collection(`facilities/${facilityId}/auditLogs`)
  await db.runTransaction(async (tx) => {
    const last = await tx.get(col.orderBy('timestamp', 'desc').limit(1))
    const previousHash = last.empty ? 'GENESIS' : String(last.docs[0].get('currentHash'))
    const payload = JSON.stringify(entry)
    const currentHash = hashAuditEntry(previousHash, payload, auditSalt(facilityId))
    const now = new Date()
    tx.set(col.doc(), { ...entry, timestamp: now, previousHash, currentHash, createdAt: now, origin: 'relay' })
  })
}

/** Fan quarantine out to the async timers (same three events as the sync mapper). */
async function fanOutQuarantine(base: Record<string, unknown>): Promise<void> {
  try {
    const publisher = await getPublisher()
    if (!publisher.connected) return
    await publisher.publish(EVENTS_EXCHANGE, ROUTING_KEYS.complianceQuarantined, base)
    await publisher.publish(EVENTS_EXCHANGE, ROUTING_KEYS.escalationSchedule10m, { ...base, dueAfter: '10m', escalateTo: 'FACILITY_MANAGER' })
    await publisher.publish(EVENTS_EXCHANGE, ROUTING_KEYS.escalationSchedule30m, { ...base, dueAfter: '30m', escalateTo: 'BDM' })
  } catch (err) {
    console.warn('[relay] quarantine fan-out failed (alert+audit already committed):', (err as Error).message)
  }
}

export function attachRelayHandlers(db: FirestoreDb): void {
  // Warm-up guards: the first snapshot replays existing docs as "added" —
  // acting on it would duplicate every audit entry. Skip one full snapshot
  // per collection (snapshots arrive independently).
  let queueWarmed = false
  let checksWarmed = false
  let alertsWarmed = false
  // Steady-state parity with the Functions' before!==after check: the Admin
  // listener has no "before", so remember last-seen statuses in memory.
  const lastStatus = new Map<string, string>()
  const fannedOut = new Set<string>()

  db.collectionGroup('queue').onSnapshot((snap) => {
    if (!queueWarmed) {
      queueWarmed = true
      for (const change of snap.docChanges()) {
        const data = change.doc.data() ?? {}
        lastStatus.set(change.doc.ref.path, String(data.status ?? ''))
      }
      return
    }
    void (async () => {
      for (const change of snap.docChanges()) {
        const data = change.doc.data() ?? {}
        const facilityId = facilityFromPath(change.doc.ref.path)
        if (!facilityId) continue
        const queueEntryId = change.doc.ref.path.split('/').pop() ?? 'unknown'
        const afterStatus = String(data.status ?? '')
        if (change.type === 'added') {
          lastStatus.set(change.doc.ref.path, afterStatus)
          await appendAuditLog(db, facilityId, { action: 'CREATE', entityType: 'queueEntry', entityId: queueEntryId, afterState: data })
          continue
        }
        if (change.type !== 'modified' || lastStatus.get(change.doc.ref.path) === afterStatus) continue
        lastStatus.set(change.doc.ref.path, afterStatus)
        const action = decideQueueChange({ added: false, modified: true, beforeStatus: '', afterStatus })
        if (action === 'quarantine') {
          await db
            .collection(`facilities/${facilityId}/alerts`)
            .doc(quarantineAlertId(queueEntryId))
            .set(
              { ...quarantineAlertPayload(String(data.licensePlate ?? queueEntryId), queueEntryId), triggeredAt: new Date(), createdAt: new Date() },
              { merge: true },
            )
          // Dedupe fan-out per process lifetime: timers were scheduled on the
          // first quarantine sighting; repeat edits must not reschedule.
          if (!fannedOut.has(queueEntryId)) {
            fannedOut.add(queueEntryId)
            await fanOutQuarantine({ queueEntryId, facilityId, regNumber: data.licensePlate })
          }
        }
        await appendAuditLog(db, facilityId, { action: 'UPDATE', entityType: 'queueEntry', entityId: queueEntryId, afterState: { status: afterStatus } })
      }
    })()
  })

  db.collectionGroup('complianceChecks').onSnapshot((snap) => {
    if (!checksWarmed) {
      checksWarmed = true
      return
    }
    void (async () => {
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue
        const data = change.doc.data() ?? {}
        const facilityId = facilityFromPath(change.doc.ref.path)
        if (!facilityId) continue
        const checkId = change.doc.ref.path.split('/').pop() ?? 'unknown'
        await appendAuditLog(db, facilityId, {
          action: data.overallStatus === 'PASS' ? 'GATE_RELEASE' : 'CREATE',
          entityType: 'complianceCheck',
          entityId: checkId,
          afterState: { overallStatus: data.overallStatus, queueEntryId: data.queueEntryId },
        })
      }
    })()
  })

  db.collectionGroup('alerts').onSnapshot((snap) => {
    if (!alertsWarmed) {
      alertsWarmed = true
      return
    }
    void (async () => {
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue
        const data = change.doc.data() ?? {}
        const id = change.doc.ref.path.split('/').pop() ?? 'unknown'
        // Pilot: log only — SMS timers fire from the quarantine fan-out above.
        console.log('[relay] alert.triggered', { id, severity: data.severity, type: data.type })
      }
    })()
  })
}

async function loadServiceAccount(): Promise<{ projectId: string; key: Record<string, unknown> }> {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE
  if (file) {
    const { readFile } = await import('node:fs/promises')
    const key = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    if (!projectId && typeof key.project_id === 'string') return { projectId: key.project_id, key }
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID required alongside FIREBASE_SERVICE_ACCOUNT_FILE')
    return { projectId, key }
  }
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!projectId || !saJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_FILE or FIREBASE_PROJECT_ID + FIREBASE_SERVICE_ACCOUNT_JSON required (service account needs Cloud Datastore User role).')
  }
  return { projectId, key: JSON.parse(saJson) as Record<string, unknown> }
}

async function main(): Promise<void> {
  const { projectId, key } = await loadServiceAccount()
  // Lazy imports: keep firebase-admin out of the API/worker boot path.
  const { initializeApp, getApps, cert } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  if (getApps().length === 0) {
    initializeApp({ credential: cert(key as never), projectId })
  }
  attachRelayHandlers(getFirestore() as unknown as FirestoreDb)
  console.log(`[relay] watching Firestore project=${projectId} (Spark-compatible, no Blaze)`)
}

const isEntry = process.argv[1]?.endsWith('relay.ts') || process.argv[1]?.endsWith('relay.js')
if (isEntry) {
  main().catch((err) => {
    console.error('[relay] fatal:', err)
    process.exit(1)
  })
}
