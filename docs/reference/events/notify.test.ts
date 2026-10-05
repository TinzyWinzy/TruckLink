import { describe, expect, it } from 'vitest'
import { notifyEscalation, quarantineTemplatePayload } from './notify.js'

describe('quarantineTemplatePayload', () => {
  it('builds the Meta template body in parameter order', () => {
    const p = quarantineTemplatePayload('263771234567', {
      regNumber: 'AFK-4921',
      overloadKg: 2000,
      overloadFeeUsd: 1000,
      dueAfter: '10m',
    }) as { template: { name: string; components: Array<{ parameters: Array<{ text: string }> }> } }
    expect(p.template.name).toBe('quarantine_alert')
    expect(p.template.components[0].parameters.map((x) => x.text)).toEqual(['AFK-4921', '2000', '1000', '10m'])
  })
})

describe('notifyEscalation fallback chain', () => {
  it('logs when no channel is configured (pilot default)', async () => {
    const r = await notifyEscalation('FACILITY_MANAGER', 'test text', {
      regNumber: 'X',
      overloadKg: 0,
      overloadFeeUsd: 0,
      dueAfter: '10m',
    })
    expect(r).toBe('log')
  })
})
