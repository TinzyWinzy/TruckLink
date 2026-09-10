import { describe, expect, it } from 'vitest'
import { canAccess, type Role } from './session'

const ALL: Role[] = [
  'DISPATCH_SUPERVISOR',
  'FACILITY_MANAGER',
  'OPERATIONS_SUPERVISOR',
  'EXECUTIVE',
  'ADMIN',
  'COMPLIANCE_OFFICER',
]

describe('canAccess (firestore.rules mirror)', () => {
  it('denies signed-out role for every gate', () => {
    for (const gate of [
      ['DISPATCH_SUPERVISOR'],
      ['ADMIN'],
      ['COMPLIANCE_OFFICER', 'ADMIN', 'EXECUTIVE', 'FACILITY_MANAGER'],
    ] as Role[][]) {
      expect(canAccess(null, gate)).toBe(false)
    }
  })

  it('queue.create: supervisors only', () => {
    const gate: Role[] = ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR']
    expect(canAccess('DISPATCH_SUPERVISOR', gate)).toBe(true)
    expect(canAccess('OPERATIONS_SUPERVISOR', gate)).toBe(true)
    for (const r of ALL.filter((x) => !gate.includes(x))) expect(canAccess(r, gate)).toBe(false)
  })

  it('audit read: compliance/admin/executive/facility-manager only', () => {
    const gate: Role[] = ['COMPLIANCE_OFFICER', 'ADMIN', 'EXECUTIVE', 'FACILITY_MANAGER']
    expect(canAccess('DISPATCH_SUPERVISOR', gate)).toBe(false)
    expect(canAccess('OPERATIONS_SUPERVISOR', gate)).toBe(false)
    for (const r of gate) expect(canAccess(r, gate)).toBe(true)
  })

  it('admin seed: ADMIN only', () => {
    expect(canAccess('ADMIN', ['ADMIN'])).toBe(true)
    for (const r of ALL.filter((x) => x !== 'ADMIN')) expect(canAccess(r, ['ADMIN'])).toBe(false)
  })
})
