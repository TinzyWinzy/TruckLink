import { describe, expect, it } from 'vitest'
import { isWebSerialSupported, parseWeighbridgeLine } from './serial'

describe('parseWeighbridgeLine (FR-INT1)', () => {
  it('parses stable gross lines', () => {
    expect(parseWeighbridgeLine('ST,GS,+  12340 kg')).toMatchObject({ weightKg: 12340, stable: true })
  })

  it('marks unstable/motion lines', () => {
    const r = parseWeighbridgeLine('US,GS,+  12340 kg')
    expect(r?.weightKg).toBe(12340)
    expect(r?.stable).toBe(false)
  })

  it('parses bare numeric payloads', () => {
    expect(parseWeighbridgeLine('+9500')?.weightKg).toBe(9500)
    expect(parseWeighbridgeLine('WT 22000 KG')?.weightKg).toBe(22000)
  })

  it('rejects non-weight lines', () => {
    expect(parseWeighbridgeLine('READY')).toBeNull()
    expect(parseWeighbridgeLine('')).toBeNull()
  })

  it('reports Web Serial support honestly', () => {
    expect(typeof isWebSerialSupported()).toBe('boolean')
  })
})
