import { describe, expect, it } from 'vitest'
import { resolveSiLimits } from './siTables'
import { resolveAxleLimits } from '../live'

describe('resolveSiLimits (Phase 3 corridors)', () => {
  it('resolves route + vehicle from bundled pilot defaults', () => {
    expect(resolveSiLimits('BEITBRIDGE', 'TANKER', undefined)).toEqual([8000, 8000, 9000])
    expect(resolveSiLimits('FORBES', 'REFRIGERATED', undefined)).toEqual([7500, 9000, 9000])
  })

  it('prefers route table over global table', () => {
    const remote = {
      siTablesByRoute: { BEITBRIDGE: { DEFAULT: [7000, 8000, 8000] } },
      siTables: { DEFAULT: [8000, 9000, 9000] },
    }
    expect(resolveSiLimits('BEITBRIDGE', 'FLATBED', remote)).toEqual([7000, 8000, 8000])
    // Other routes fall through to the global table
    expect(resolveSiLimits('CHIRUNDU', 'FLATBED', remote)).toEqual([8000, 9000, 9000])
  })

  it('falls back through route DEFAULT then global DEFAULT', () => {
    const remote = {
      siTablesByRoute: { CHIRUNDU: { DEFAULT: [7100, 8100, 8100] } },
    }
    expect(resolveSiLimits('CHIRUNDU', 'UNKNOWN_TYPE', remote)).toEqual([7100, 8100, 8100])
    expect(resolveSiLimits('BEITBRIDGE', 'UNKNOWN_TYPE', remote)).toEqual([8000, 9000, 9000])
  })

  it('normalizes unknown routes to DEFAULT', () => {
    expect(resolveSiLimits('NONSENSE', 'DEFAULT', undefined)).toEqual([8000, 9000, 9000])
  })
})

describe('resolveAxleLimits backwards compat', () => {
  it('keeps legacy 3-arg calls working', () => {
    expect(
      resolveAxleLimits({ DEFAULT: [8000, 9000, 9000] }, undefined, 'FLATBED'),
    ).toEqual([8000, 9000, 9000])
  })

  it('accepts route + route tables', () => {
    expect(
      resolveAxleLimits(undefined, undefined, 'TANKER', 'BEITBRIDGE', {
        BEITBRIDGE: { TANKER: [8000, 8000, 9000] },
      }),
    ).toEqual([8000, 8000, 9000])
  })
})
