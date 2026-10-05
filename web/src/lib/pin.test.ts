import { describe, expect, it } from 'vitest'
import { parsePinCredentials, pinEmail, pinPassword } from './pin'

describe('shift-PIN credentials', () => {
  it('maps Staff ID to the synthetic login email', () => {
    expect(pinEmail('BAK-07-TAFADZWA')).toBe('pin.bak-07-tafadzwa@bak-logistics.internal')
    expect(pinEmail('  Bak 07 Tafadzwa ')).toBe('pin.bak07tafadzwa@bak-logistics.internal')
  })

  it('derives a Firebase-legal password even for 4-digit PINs', () => {
    expect(pinPassword('5678')).toBe('BAK-5678-PIN')
    expect(pinPassword('5678').length).toBeGreaterThanOrEqual(6)
    expect(pinPassword('1').length).toBeGreaterThanOrEqual(6)
  })

  it('parses tablet input or throws yard-plain errors', () => {
    expect(parsePinCredentials('BAK-07-TAFADZWA', '5678')).toEqual({
      email: 'pin.bak-07-tafadzwa@bak-logistics.internal',
      password: 'BAK-5678-PIN',
    })
    expect(() => parsePinCredentials('', '5678')).toThrow(/Staff ID/)
    expect(() => parsePinCredentials('BAK-07', '12')).toThrow(/4–12 digits/)
    expect(() => parsePinCredentials('BAK-07', 'abcd')).toThrow(/4–12 digits/)
  })

  it('client derivation matches the provisioning script contract', () => {
    // provision-pin.ts must use the identical `BAK-<pin>-PIN` scheme.
    const { password } = parsePinCredentials('ANY-ID', '9999')
    expect(password).toBe('BAK-9999-PIN')
  })
})
