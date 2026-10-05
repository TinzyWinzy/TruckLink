import { describe, expect, it } from 'vitest'
import { canTransition, validateLoad } from './compliance'

describe('validateLoad', () => {
  it('passes when all axles and GVM are within limits', () => {
    const result = validateLoad({
      axleConfiguration: '2-4-2',
      measuredWeights: [6000, 8000, 8000],
      limits: [8000, 9000, 9000],
      totalWeight: 22000,
      gvmRating: 24000,
    })
    expect(result.overallStatus).toBe('PASS')
    expect(result.violations).toHaveLength(0)
  })

  it('fails the overloaded axle and flags quarantine', () => {
    const result = validateLoad({
      axleConfiguration: '2-4-2',
      measuredWeights: [9500, 8000, 8000],
      limits: [8000, 9000, 9000],
      totalWeight: 25500,
      gvmRating: 24000,
    })
    expect(result.overallStatus).toBe('FAIL')
    expect(result.axles[0].status).toBe('FAIL')
    expect(result.gvmStatus).toBe('FAIL')
    expect(result.violations.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects mismatched weight/limit arrays', () => {
    expect(() =>
      validateLoad({
        axleConfiguration: '2-4',
        measuredWeights: [6000],
        limits: [8000, 9000],
        totalWeight: 6000,
        gvmRating: 24000,
      }),
    ).toThrow()
  })
})

describe('canTransition', () => {
  it('allows QUARANTINED -> PENDING_OVERRIDE -> OVERRIDE_APPROVED -> RELEASED', () => {
    expect(canTransition('QUARANTINED', 'PENDING_OVERRIDE')).toBe(true)
    expect(canTransition('PENDING_OVERRIDE', 'OVERRIDE_APPROVED')).toBe(true)
    expect(canTransition('OVERRIDE_APPROVED', 'RELEASED')).toBe(true)
  })

  it('blocks RELEASED -> QUEUED and direct QUARANTINED -> RELEASED', () => {
    expect(canTransition('RELEASED', 'QUEUED')).toBe(false)
    expect(canTransition('QUARANTINED', 'RELEASED')).toBe(false)
  })
})
