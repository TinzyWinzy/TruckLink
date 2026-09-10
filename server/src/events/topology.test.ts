import { describe, expect, it } from 'vitest'
import { assertTopology, EVENTS_EXCHANGE, QUEUES, ROUTING_KEYS, WMS_INBOUND_EXCHANGE } from './topology.js'
import { escalationTarget } from '../workers/escalation.js'
import { isAllowedPublishKey } from './publisher.js'

describe('assertTopology (Phase 4)', () => {
  it('declares exchanges, delayed wait queues and bindings', async () => {
    const calls: Array<{ fn: string; args: unknown[] }> = []
    const ch = {
      assertExchange: async (...args: unknown[]) => void calls.push({ fn: 'exchange', args }),
      assertQueue: async (...args: unknown[]) => void calls.push({ fn: 'queue', args }),
      bindQueue: async (...args: unknown[]) => void calls.push({ fn: 'bind', args }),
    }
    await assertTopology(ch)

    const exchanges = calls.filter((c) => c.fn === 'exchange').map((c) => c.args[0])
    expect(exchanges).toContain(EVENTS_EXCHANGE)
    expect(exchanges).toContain(WMS_INBOUND_EXCHANGE)

    const queues = calls.filter((c) => c.fn === 'queue').map((c) => c.args[0])
    for (const q of Object.values(QUEUES)) expect(queues).toContain(q)

    const binds = calls.filter((c) => c.fn === 'bind').map((c) => c.args.join('|'))
    expect(binds).toContain(`${QUEUES.alertEscalation}|${EVENTS_EXCHANGE}|${ROUTING_KEYS.complianceQuarantined}`)
    expect(binds).toContain(`${QUEUES.wmsExport}|${EVENTS_EXCHANGE}|${ROUTING_KEYS.queueCompleted}`)
    expect(binds).toContain(`${QUEUES.auditVerify}|${EVENTS_EXCHANGE}|${ROUTING_KEYS.auditEntry}`)
    expect(binds).toContain(`${QUEUES.manifestIngest}|${WMS_INBOUND_EXCHANGE}|${ROUTING_KEYS.manifestImport}`)
  })
})

describe('escalation routing', () => {
  it('schedules on quarantine, targets FM at 10m and BDM at 30m', () => {
    expect(escalationTarget({ queueId: 'q-1' }, ROUTING_KEYS.complianceQuarantined)).toBeNull()
    expect(escalationTarget({ queueId: 'q-1' }, ROUTING_KEYS.escalationDue10m)).toBe('FACILITY_MANAGER')
    expect(escalationTarget({ queueId: 'q-1' }, ROUTING_KEYS.escalationDue30m)).toBe('BDM')
  })

  it('allow-lists only known routing keys for direct publish', () => {
    expect(isAllowedPublishKey(ROUTING_KEYS.complianceQuarantined)).toBe(true)
    expect(isAllowedPublishKey('evil.key')).toBe(false)
  })
})
