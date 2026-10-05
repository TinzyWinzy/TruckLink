import { describe, expect, it } from 'vitest'
import { toErpTicket } from './adapter.js'

const BASE = {
  queueEntryId: 'q-1',
  facilityId: 'demo-facility',
  regNumber: 'AFK-4921',
  status: 'RELEASED',
  exitTimestamp: '2026-09-10T10:00:00Z',
  overloadKg: 0,
  overloadFeeUsd: 0,
  dwellSeconds: 3600,
  source: 'bak-opshield',
}

describe('toErpTicket (Phase 5 mapping)', () => {
  it('maps canonical fields for generic-http', () => {
    const body = toErpTicket(BASE, 'generic-http')
    expect(body).toMatchObject({
      externalRef: 'q-1',
      facility: 'demo-facility',
      vehicleReg: 'AFK-4921',
      gateStatus: 'RELEASED',
      sourceSystem: 'BAK-OPSHIELD',
    })
  })

  it('adds the sap envelope without dropping core fields', () => {
    const body = toErpTicket(BASE, 'sap')
    expect(body).toMatchObject({ idocType: 'YARD_GATE_TICKET', externalRef: 'q-1' })
  })

  it('adds the syspro envelope without dropping core fields', () => {
    const body = toErpTicket(BASE, 'syspro')
    expect(body).toMatchObject({ businessObject: 'GateTicket', externalRef: 'q-1' })
  })
})
