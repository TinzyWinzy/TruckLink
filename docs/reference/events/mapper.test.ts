import { describe, expect, it } from 'vitest'
import { mapSyncItemToEvents } from './mapper.js'
import { ROUTING_KEYS } from './topology.js'

describe('mapSyncItemToEvents (Phase 4)', () => {
  it('maps quarantined compliance to quarantine + 10m/30m timers', () => {
    const events = mapSyncItemToEvents({
      op: 'PUT',
      table: 'compliance_checks',
      id: 'chk-1',
      data: {
        facility_id: 'demo-facility',
        queue_id: 'q-1',
        reg_number: 'OVR-1234',
        status: 'QUARANTINED',
        overload_kg: 2000,
        overload_fee_usd: 1000,
        timestamp: '2026-09-10T00:00:00Z',
      },
    })
    expect(events.map((e) => e.routingKey)).toEqual([
      ROUTING_KEYS.complianceQuarantined,
      ROUTING_KEYS.escalationSchedule10m,
      ROUTING_KEYS.escalationSchedule30m,
    ])
  })

  it('maps completed/released queue entries to wms export', () => {
    const events = mapSyncItemToEvents({
      op: 'PATCH',
      table: 'queue_entries',
      id: 'q-9',
      data: { facility_id: 'demo-facility', reg_number: 'AFK-4921', status: 'RELEASED' },
    })
    expect(events).toHaveLength(1)
    expect(events[0].routingKey).toBe(ROUTING_KEYS.queueCompleted)
  })

  it('maps audit logs to verify queue, ignores deletes and unknowns', () => {
    expect(
      mapSyncItemToEvents({ op: 'PUT', table: 'audit_logs', id: 'a-1', data: { facility_id: 'f', action: 'X' } })[0]
        .routingKey,
    ).toBe(ROUTING_KEYS.auditEntry)
    expect(mapSyncItemToEvents({ op: 'DELETE', table: 'audit_logs', id: 'a-1' })).toEqual([])
    expect(mapSyncItemToEvents({ op: 'PUT', table: 'docks', id: 'd-1', data: {} })).toEqual([])
    // PATCH without status carries no signal
    expect(mapSyncItemToEvents({ op: 'PATCH', table: 'queue_entries', id: 'q-1', data: {} })).toEqual([])
  })
})
