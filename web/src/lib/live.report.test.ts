import { describe, expect, it } from 'vitest'
import { computeTurnaroundStats, isSelfApproval, isSelfApprovalById, queueToCsv, resolveAxleLimits, toMillis } from './live'

describe('resolveAxleLimits (S.I. tables)', () => {
  it('picks vehicle type with DEFAULT fallback', () => {
    expect(resolveAxleLimits({ DEFAULT: [1, 2, 3], TANKER: [4, 5, 6] }, undefined, 'tanker')).toEqual([4, 5, 6])
    expect(resolveAxleLimits({ DEFAULT: [1, 2, 3] }, undefined, 'FLATBED')).toEqual([1, 2, 3])
    expect(resolveAxleLimits(undefined, { default: [7, 8, 9] }, 'ANY')).toEqual([7, 8, 9])
    expect(resolveAxleLimits(undefined, undefined, 'ANY')).toEqual([8000, 9000, 9000])
  })
})

describe('computeTurnaroundStats (FR-A4)', () => {
  it('splits active waits from completed turnarounds', () => {
    const now = Date.now()
    const stats = computeTurnaroundStats(
      [
        { id: 'a', status: 'QUEUED', entryTimestamp: new Date(now - 30 * 60000).toISOString() },
        { id: 'b', status: 'RELEASED', entryTimestamp: new Date(now - 100 * 60000).toISOString(), exitTimestamp: new Date(now - 40 * 60000).toISOString() },
        { id: 'c', status: 'QUEUED', entryTimestamp: new Date(now - 74 * 60000).toISOString() },
      ],
      now,
    )
    expect(stats.total).toBe(3)
    expect(stats.byStatus.QUEUED).toBe(2)
    expect(Math.round(stats.avgWaitMinutes ?? 0)).toBe(52)
    expect(Math.round(stats.avgTurnaroundMinutes ?? 0)).toBe(60)
    expect(stats.overdueCount).toBe(1)
  })

  it('handles empty queues', () => {
    expect(computeTurnaroundStats([])).toMatchObject({ total: 0, avgWaitMinutes: null, avgTurnaroundMinutes: null })
  })
})

describe('queueToCsv', () => {
  it('emits header + escaped rows', () => {
    const csv = queueToCsv([{ id: 'q1', licensePlate: 'AEH 4521', status: 'QUEUED' }])
    expect(csv.split('\n')[0]).toContain('licensePlate')
    expect(csv).toContain('AEH 4521')
  })
})

describe('toMillis', () => {
  it('keeps new release authorisations and passed inspections in waiting time until observed exit', () => {
    const now=Date.parse('2026-10-07T10:00:00Z')
    const base={id:'1',milestoneSemantics:'SEPARATE_V1',entryTimestamp:'2026-10-07T08:00:00Z',updatedAt:'2026-10-07T09:00:00Z'}
    const waiting=computeTurnaroundStats([{...base,status:'RELEASED'},{...base,id:'2',status:'COMPLETED'}],now)
    expect(waiting.avgTurnaroundMinutes).toBeNull()
    expect(waiting.avgWaitMinutes).toBe(120)
    expect(waiting.overdueCount).toBe(2)
    expect(computeTurnaroundStats([{...base,status:'RELEASED',exitTimestamp:'2026-10-07T09:30:00Z'}],now).avgTurnaroundMinutes).toBe(90)
  })
  it('parses ISO and epoch', () => {
    expect(toMillis(new Date('2026-09-01T00:00:00Z').toISOString())).toBe(Date.parse('2026-09-01T00:00:00Z'))
    expect(toMillis(123)).toBe(123)
    expect(toMillis(null)).toBeNull()
  })
})

describe('isSelfApproval (secondary-approver parity)', () => {
  it('flags the requester approving their own override', () => {
    expect(isSelfApproval('T. Moyo', 'T. Moyo')).toBe(true)
    expect(isSelfApproval('  T. Moyo  ', 'T. Moyo')).toBe(true)
  })

  it('allows distinct approvers and unknown requesters', () => {
    expect(isSelfApproval('T. Moyo', 'C. Sibanda')).toBe(false)
    expect(isSelfApproval(undefined, 'C. Sibanda')).toBe(false)
    expect(isSelfApproval('', 'C. Sibanda')).toBe(false)
    expect(isSelfApproval(null, 'C. Sibanda')).toBe(false)
  })
})

describe('isSelfApprovalById (unified stable-ID rule)', () => {
  it('flags matching user IDs, trims whitespace', () => {
    expect(isSelfApprovalById('uid-1', 'uid-1')).toBe(true)
    expect(isSelfApprovalById('  uid-1  ', 'uid-1')).toBe(true)
  })

  it('allows distinct IDs and unknown requesters', () => {
    expect(isSelfApprovalById('uid-1', 'uid-2')).toBe(false)
    expect(isSelfApprovalById(undefined, 'uid-2')).toBe(false)
    expect(isSelfApprovalById('', 'uid-2')).toBe(false)
    expect(isSelfApprovalById(null, 'uid-2')).toBe(false)
  })
})
