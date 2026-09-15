// Shift-PIN login (pilot-grade).
//
// Firebase Auth has no native PIN, so each staffer gets a provisioned user:
//   email    = pin.<normalized-staff-id>@bak-logistics.internal (unroutable, never emailed)
//   password = derived `BAK-<pin>-PIN` (stays >= 6 chars even for 4-digit PINs)
//
// Provisioning is ADMIN-only via functions/src/provision-pin.ts. The tablet
// holds no secrets — derivation is deterministic and public.
//
// SECURITY (pilot-grade, staging only): entropy = PIN digits alone (~10k for
// a 4-digit PIN). Firebase throttles guessing (too-many-requests lockout) and
// Firestore rules still enforce {role, facilities} claims, but this must move
// to passwords or a PIN-exchange backend before production go-live.

const PIN_DOMAIN = 'bak-logistics.internal'

export function normalizeStaffId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '')
}

export function pinEmail(staffId: string): string {
  return `pin.${normalizeStaffId(staffId)}@${PIN_DOMAIN}`
}

/** Deterministic password derivation — mirrors provision-pin.ts exactly. */
export function pinPassword(pin: string): string {
  return `BAK-${pin.trim()}-PIN`
}

export function parsePinCredentials(
  staffId: string,
  pin: string,
): { email: string; password: string } {
  const id = normalizeStaffId(staffId)
  const digits = pin.trim()
  if (!id) throw new Error('Enter your Staff ID (e.g. BAK-07-TAFADZWA).')
  if (!/^\d{4,12}$/.test(digits)) throw new Error('PIN must be 4–12 digits.')
  return { email: pinEmail(id), password: pinPassword(digits) }
}
