// Phase 4 async orchestration topology (RabbitMQ).
// Pilot rule: the API never requires a broker. When RABBITMQ_URL is unset the
// publisher is a NoOp and events sit in the Postgres outbox (see outbox.ts)
// until a worker relay drains them. No prod broker needed for the 3-tablet pilot.

export const EVENTS_EXCHANGE = 'bak.events'
export const WMS_INBOUND_EXCHANGE = 'bak.wms.inbound'

export const ROUTING_KEYS = {
  complianceQuarantined: 'compliance.quarantined',
  escalationSchedule10m: 'escalation.schedule.10m',
  escalationSchedule30m: 'escalation.schedule.30m',
  escalationDue10m: 'escalation.due.10m',
  escalationDue30m: 'escalation.due.30m',
  queueCompleted: 'queue.completed',
  auditEntry: 'audit.entry',
  manifestImport: 'manifest.import',
} as const

export type RoutingKey = (typeof ROUTING_KEYS)[keyof typeof ROUTING_KEYS]

export const ALLOWED_PUBLISH_KEYS: ReadonlySet<string> = new Set<string>([
  ROUTING_KEYS.complianceQuarantined,
  ROUTING_KEYS.escalationSchedule10m,
  ROUTING_KEYS.escalationSchedule30m,
  ROUTING_KEYS.escalationDue10m,
  ROUTING_KEYS.escalationDue30m,
  ROUTING_KEYS.queueCompleted,
  ROUTING_KEYS.auditEntry,
])

export const QUEUES = {
  alertEscalation: 'q.alert.escalation',
  alertWait10m: 'q.alert.escalation.wait.10m',
  alertWait30m: 'q.alert.escalation.wait.30m',
  wmsExport: 'q.wms.export',
  auditVerify: 'q.audit.verify',
  manifestIngest: 'q.manifest.ingest',
} as const

export const TEN_MIN_MS = 10 * 60 * 1000
export const THIRTY_MIN_MS = 30 * 60 * 1000

/** Minimal channel surface we need — lets unit-test without a broker. */
export interface TopologyChannel {
  assertExchange(name: string, type: string, opts?: Record<string, unknown>): Promise<void>
  assertQueue(name: string, opts?: Record<string, unknown>): Promise<void>
  bindQueue(queue: string, exchange: string, routingKey: string): Promise<void>
}

/** Declare exchanges, queues and bindings. Idempotent — safe on every boot. */
export async function assertTopology(ch: TopologyChannel): Promise<void> {
  await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true })
  await ch.assertExchange(WMS_INBOUND_EXCHANGE, 'direct', { durable: true })

  // Immediate escalation inbox: quarantine events + due timer callbacks.
  await ch.assertQueue(QUEUES.alertEscalation, { durable: true })
  await ch.bindQueue(QUEUES.alertEscalation, EVENTS_EXCHANGE, ROUTING_KEYS.complianceQuarantined)
  await ch.bindQueue(QUEUES.alertEscalation, EVENTS_EXCHANGE, ROUTING_KEYS.escalationDue10m)
  await ch.bindQueue(QUEUES.alertEscalation, EVENTS_EXCHANGE, ROUTING_KEYS.escalationDue30m)

  // Delayed wait queues: TTL expiry dead-letters back to bak.events as due.*.
  await ch.assertQueue(QUEUES.alertWait10m, {
    durable: true,
    arguments: {
      'x-message-ttl': TEN_MIN_MS,
      'x-dead-letter-exchange': EVENTS_EXCHANGE,
      'x-dead-letter-routing-key': ROUTING_KEYS.escalationDue10m,
    },
  })
  await ch.bindQueue(QUEUES.alertWait10m, EVENTS_EXCHANGE, ROUTING_KEYS.escalationSchedule10m)

  await ch.assertQueue(QUEUES.alertWait30m, {
    durable: true,
    arguments: {
      'x-message-ttl': THIRTY_MIN_MS,
      'x-dead-letter-exchange': EVENTS_EXCHANGE,
      'x-dead-letter-routing-key': ROUTING_KEYS.escalationDue30m,
    },
  })
  await ch.bindQueue(QUEUES.alertWait30m, EVENTS_EXCHANGE, ROUTING_KEYS.escalationSchedule30m)

  await ch.assertQueue(QUEUES.wmsExport, { durable: true })
  await ch.bindQueue(QUEUES.wmsExport, EVENTS_EXCHANGE, ROUTING_KEYS.queueCompleted)

  await ch.assertQueue(QUEUES.auditVerify, { durable: true })
  await ch.bindQueue(QUEUES.auditVerify, EVENTS_EXCHANGE, ROUTING_KEYS.auditEntry)

  await ch.assertQueue(QUEUES.manifestIngest, { durable: true })
  await ch.bindQueue(QUEUES.manifestIngest, WMS_INBOUND_EXCHANGE, ROUTING_KEYS.manifestImport)
}
