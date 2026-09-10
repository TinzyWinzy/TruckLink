// Firestore relay decisions (pure, unit-tested). Mirrors functions/src/index.ts
// trigger semantics so the self-hosted relay behaves identically to the
// deployed Functions it replaces (no Blaze plan required).

export interface QueueChange {
  beforeStatus?: string
  afterStatus?: string
  licensePlate?: string
}

export type QueueAction = 'none' | 'audit-create' | 'audit-update' | 'quarantine'

/** added -> audit CREATE; status change -> audit UPDATE; -> QUARANTINED adds alert. */
export function decideQueueChange(change: { added: boolean; modified: boolean } & QueueChange): QueueAction {
  if (change.added) return 'audit-create'
  if (!change.modified) return 'none'
  if (change.beforeStatus === change.afterStatus) return 'none'
  if (change.afterStatus === 'QUARANTINED') return 'quarantine'
  return 'audit-update'
}

export function quarantineAlertId(queueEntryId: string): string {
  return `quar-${queueEntryId}`
}

export function quarantineAlertPayload(licensePlateOrId: string, queueEntryId: string): Record<string, unknown> {
  return {
    type: 'COMPLIANCE_FAILURE',
    severity: 'CRITICAL',
    escalationLevel: 0,
    relatedEntityType: 'queueEntry',
    relatedEntityId: queueEntryId,
    message: `Vehicle quarantined: ${licensePlateOrId}`,
    status: 'ACTIVE',
  }
}

/** Extract facilityId from a `facilities/{fid}/...` document path. */
export function facilityFromPath(path: string): string | null {
  const m = /^facilities\/([^/]+)\//.exec(path)
  return m ? m[1] : null
}
