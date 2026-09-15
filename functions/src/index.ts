/**
 * Cloud Functions skeleton — BAK Operational Intelligence Layer (Spec §9.3, §7.4).
 * Deploy target: Firebase project radbit-bak-staging, then radbit-bak-prod.
 * All triggers idempotent: clients send idempotency keys (offline queue IDs);
 * handlers check for existing processed keys before mutating.
 */
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions/v2'
import { hashAuditEntry } from './audit.js'

initializeApp()
const db = getFirestore()

async function appendAuditLog(
  facilityId: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const col = db.collection(`facilities/${facilityId}/auditLogs`)
  const metaRef = db.doc(`facilities/${facilityId}/_meta/audit`)
  // Fail-closed (H3): a missing salt must not silently chain onto a default.
  const salt = process.env[`AUDIT_SALT_${facilityId}`] ?? process.env.AUDIT_SALT
  if (!salt) {
    logger.error(`AUDIT_SALT (or AUDIT_SALT_${facilityId}) unset — refusing to append audit entry`)
    return
  }
  // Serialized append (M3): a single per-facility meta doc arbitrates order, so
  // concurrent writers conflict and retry instead of forking the chain.
  await db.runTransaction(async (tx) => {
    const meta = await tx.get(metaRef)
    let previousHash = 'GENESIS'
    let seq = 0
    const m = meta.data()
    if (m && m.currentHash) {
      previousHash = String(m.currentHash)
      seq = Number(m.seq ?? 0)
    } else if (meta.exists) {
      // Meta exists but empty migrated doc — treat as genesis.
    } else {
      const tail = await tx.get(col.orderBy('timestamp', 'desc').limit(1))
      if (!tail.empty) previousHash = tail.docs[0].get('currentHash') as string
    }
    const payload = JSON.stringify(entry)
    const currentHash = hashAuditEntry(previousHash, payload, salt)
    const ref = col.doc()
    tx.set(ref, {
      ...entry,
      timestamp: FieldValue.serverTimestamp(),
      previousHash,
      currentHash,
      createdAt: FieldValue.serverTimestamp(),
    })
    tx.set(metaRef, { currentHash, seq: seq + 1, lastEntryAt: FieldValue.serverTimestamp() }, { merge: true })
  })
}

// --- Queue triggers (Spec §9.3) ----------------------------------------------
export const onQueueEntryCreated = onDocumentCreated(
  'facilities/{facilityId}/queue/{queueEntryId}',
  async (event) => {
    const { facilityId, queueEntryId } = event.params
    const data = event.data?.data()
    if (!data) return
    logger.info('queue.entry.created', { facilityId, queueEntryId })
    await appendAuditLog(facilityId, {
      action: 'CREATE',
      entityType: 'queueEntry',
      entityId: queueEntryId,
      afterState: data,
    })
  },
)

export const onQueueEntryStatusChanged = onDocumentUpdated(
  'facilities/{facilityId}/queue/{queueEntryId}',
  async (event) => {
    const { facilityId, queueEntryId } = event.params
    const before = event.data?.before.data()
    const after = event.data?.after.data()
    if (!before || !after || before.status === after.status) return
    logger.info('queue.entry.status_changed', { facilityId, queueEntryId, from: before.status, to: after.status })

    if (after.status === 'QUARANTINED') {
      // Deterministic ID: client writes the same doc optimistically, set-merge keeps it idempotent.
      await db.doc(`facilities/${facilityId}/alerts/quar-${queueEntryId}`).set(
        {
          type: 'COMPLIANCE_FAILURE',
          severity: 'CRITICAL',
          triggeredAt: FieldValue.serverTimestamp(),
          escalationLevel: 0,
          relatedEntityType: 'queueEntry',
          relatedEntityId: queueEntryId,
          message: `Vehicle quarantined: ${after.licensePlate ?? queueEntryId}`,
          status: 'ACTIVE',
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    }
    await appendAuditLog(facilityId, {
      action: 'UPDATE',
      entityType: 'queueEntry',
      entityId: queueEntryId,
      beforeState: { status: before.status },
      afterState: { status: after.status },
    })
  },
)

// --- Compliance trigger -------------------------------------------------------
export const onComplianceCheckCompleted = onDocumentCreated(
  'facilities/{facilityId}/complianceChecks/{checkId}',
  async (event) => {
    const { facilityId, checkId } = event.params
    const data = event.data?.data()
    if (!data) return
    logger.info('compliance.check.completed', { facilityId, checkId, status: data.overallStatus })
    await appendAuditLog(facilityId, {
      action: data.overallStatus === 'PASS' ? 'GATE_RELEASE' : 'CREATE',
      entityType: 'complianceCheck',
      entityId: checkId,
      afterState: { overallStatus: data.overallStatus, queueEntryId: data.queueEntryId },
    })
  },
)

// --- Alert escalation (Spec §9.3: 10min → FM, 30min → Exec) --------------------
export const onAlertCreated = onDocumentCreated(
  'facilities/{facilityId}/alerts/{alertId}',
  async (event) => {
    const { facilityId, alertId } = event.params
    const data = event.data?.data()
    if (!data) return
    // Pilot: log only. Staging wires SMS/email gateway + scheduled escalation check.
    logger.info('alert.triggered', {
      facilityId,
      alertId,
      severity: data.severity,
      type: data.type,
    })
  },
)
