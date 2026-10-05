// Pure mapper: PowerSync upload items -> domain events (Phase 4).
// No DB, no broker — fully unit-tested. The upload handler inserts the
// returned events into the outbox inside the same transaction, then relays
// them after COMMIT (see publisher.ts).

import { EVENTS_EXCHANGE, ROUTING_KEYS } from './topology.js'

export interface SyncItem {
  op: string
  table: string
  data?: Record<string, unknown>
  id: string
}

export interface DomainEvent {
  exchange: string
  routingKey: string
  payload: Record<string, unknown>
}

function isQuarantinedCompliance(item: SyncItem): boolean {
  if (item.table !== 'compliance_checks') return false
  const status = String(item.data?.status ?? '').toUpperCase()
  return status === 'QUARANTINED'
}

function isCompletedQueueEntry(item: SyncItem): boolean {
  if (item.table !== 'queue_entries') return false
  const status = String(item.data?.status ?? '').toUpperCase()
  return status === 'COMPLETED' || status === 'RELEASED'
}

function isAuditLog(item: SyncItem): boolean {
  return item.table === 'audit_logs'
}

/** Map one sync item to zero or more domain events. */
export function mapSyncItemToEvents(item: SyncItem): DomainEvent[] {
  if (item.op === 'DELETE') return []
  const data = item.data ?? {}

  if (isQuarantinedCompliance(item)) {
    const base = {
      checkId: item.id,
      facilityId: data.facility_id,
      queueId: data.queue_id,
      regNumber: data.reg_number,
      overloadKg: data.overload_kg,
      overloadFeeUsd: data.overload_fee_usd,
      timestamp: data.timestamp,
    }
    return [
      { exchange: EVENTS_EXCHANGE, routingKey: ROUTING_KEYS.complianceQuarantined, payload: base },
      // Schedule both escalation timers at quarantine time; the worker skips
      // any timer whose alert is already acknowledged (see workers/escalation.ts).
      {
        exchange: EVENTS_EXCHANGE,
        routingKey: ROUTING_KEYS.escalationSchedule10m,
        payload: { ...base, dueAfter: '10m', escalateTo: 'FACILITY_MANAGER' },
      },
      {
        exchange: EVENTS_EXCHANGE,
        routingKey: ROUTING_KEYS.escalationSchedule30m,
        payload: { ...base, dueAfter: '30m', escalateTo: 'BDM' },
      },
    ]
  }

  if (isCompletedQueueEntry(item)) {
    return [
      {
        exchange: EVENTS_EXCHANGE,
        routingKey: ROUTING_KEYS.queueCompleted,
        payload: {
          queueEntryId: item.id,
          facilityId: data.facility_id,
          regNumber: data.reg_number,
          status: data.status,
          exitTimestamp: data.exit_timestamp,
        },
      },
    ]
  }

  if (isAuditLog(item)) {
    return [
      {
        exchange: EVENTS_EXCHANGE,
        routingKey: ROUTING_KEYS.auditEntry,
        payload: { auditId: item.id, facilityId: data.facility_id, action: data.action },
      },
    ]
  }

  return []
}
