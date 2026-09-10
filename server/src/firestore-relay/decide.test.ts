import { describe, expect, it } from 'vitest'
import { decideQueueChange, facilityFromPath, quarantineAlertId } from './decide.js'

describe('decideQueueChange (Functions parity)', () => {
  it('audits creates, ignores no-ops', () => {
    expect(decideQueueChange({ added: true, modified: false })).toBe('audit-create')
    expect(decideQueueChange({ added: false, modified: false })).toBe('none')
    expect(decideQueueChange({ added: false, modified: true, beforeStatus: 'QUEUED', afterStatus: 'QUEUED' })).toBe('none')
  })

  it('flags quarantine transitions, audits other status changes', () => {
    expect(decideQueueChange({ added: false, modified: true, beforeStatus: 'COMPLETED', afterStatus: 'QUARANTINED' })).toBe('quarantine')
    expect(decideQueueChange({ added: false, modified: true, beforeStatus: 'QUEUED', afterStatus: 'ASSIGNED' })).toBe('audit-update')
  })
})

describe('path helpers', () => {
  it('extracts facility and builds deterministic alert ids', () => {
    expect(facilityFromPath('facilities/demo-facility/queue/q-1')).toBe('demo-facility')
    expect(facilityFromPath('weird/path')).toBeNull()
    expect(quarantineAlertId('q-1')).toBe('quar-q-1')
  })
})
