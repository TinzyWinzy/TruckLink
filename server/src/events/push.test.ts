import { describe, expect, it } from 'vitest'
import { fcmMessage, rolesForTarget } from './push.js'

describe('rolesForTarget', () => {
  it('maps escalation targets to system roles', () => {
    expect(rolesForTarget('FACILITY_MANAGER')).toEqual(['FACILITY_MANAGER'])
    expect(rolesForTarget('BDM')).toEqual(['EXECUTIVE', 'ADMIN'])
    expect(rolesForTarget('SUPERVISOR')).toEqual(['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR'])
  })
})

describe('fcmMessage', () => {
  it('builds a high-priority message with click-through', () => {
    const m = fcmMessage('tok', { title: 'T', body: 'B', url: '/alerts' }) as {
      token: string
      notification: { title: string }
      android: { priority: string }
    }
    expect(m.token).toBe('tok')
    expect(m.notification.title).toBe('T')
    expect(m.android.priority).toBe('high')
  })
})
