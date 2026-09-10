import { describe, expect, it } from 'vitest'
import { bucketDwellByHour, checkSurge, summarizeRoi } from './compute.js'

describe('bucketDwellByHour (Phase 6)', () => {
  it('averages dwell per entry hour and skips bad hours', () => {
    const buckets = bucketDwellByHour([
      { entryHour: 6, dwellMinutes: 60 },
      { entryHour: 6, dwellMinutes: 120 },
      { entryHour: 7, dwellMinutes: null },
      { entryHour: 99, dwellMinutes: 5 },
    ])
    expect(buckets[6]).toMatchObject({ movements: 2, avgDwellMinutes: 90 })
    expect(buckets[7]).toMatchObject({ movements: 1, avgDwellMinutes: null })
    expect(buckets[8]).toMatchObject({ movements: 0, avgDwellMinutes: null })
  })
})

describe('checkSurge (Phase 6)', () => {
  it('flags queue or arrival pressure', () => {
    expect(checkSurge(20, 2).surging).toBe(true)
    expect(checkSurge(2, 50).surging).toBe(true)
    expect(checkSurge(2, 2).surging).toBe(false)
  })
})

describe('summarizeRoi (Phase 6)', () => {
  it('rolls up intercepted fines with payback multiple', () => {
    const roi = summarizeRoi([
      { overloadKg: 1500, feeUsd: 750 },
      { overloadKg: 500, feeUsd: 250 },
    ])
    expect(roi).toMatchObject({
      checksIntercepted: 2,
      overloadKgTotal: 2000,
      finesInterceptedUsd: 1000,
      pilotCostUsd: 6200,
    })
    expect(roi.paybackMultiple).toBeCloseTo(0.16, 2)
  })

  it('returns null payback with no interceptions', () => {
    expect(summarizeRoi([]).paybackMultiple).toBeNull()
  })
})
