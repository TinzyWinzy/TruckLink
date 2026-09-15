/**
 * Single-staffer PIN provisioning (staging pilot).
 * Creates/updates one Firebase Auth user for Shift-PIN login with custom
 * claims { role, facilities } so Firestore rules + Login work end-to-end.
 *
 * Credential contract (mirrors bak-logistics-app/src/lib/pin.ts EXACTLY):
 *   email    = pin.<staff-id lowercased, stripped>@bak-logistics.internal
 *   password = BAK-<pin>-PIN
 *
 * Secrets come from env vars only — NEVER commit values:
 *   PowerShell:
 *     $env:BAK_STAFF_ID="BAK-07-TAFADZWA"
 *     $env:BAK_PIN="<4-to-12-digits>"
 *     $env:BAK_ROLE="EXECUTIVE"            # optional, default EXECUTIVE
 *     $env:BAK_FACILITY_ID="demo-facility" # optional
 *     $env:BAK_DISPLAY_NAME="Tafadzwa"     # optional
 *     $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\service-account.json"
 *     npm --prefix functions run provision:pin
 *
 * To rotate a PIN later, re-run with the same STAFF_ID and the new PIN.
 * Synthetic emails are unroutable — password reset is unavailable; the ADMIN
 * re-runs this script instead.
 */
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

initializeApp()
const auth = getAuth()

const PIN_DOMAIN = 'bak-logistics.internal'

function normalizeStaffId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '')
}

async function main(): Promise<void> {
  const staffId = process.env.BAK_STAFF_ID ?? ''
  const pin = (process.env.BAK_PIN ?? '').trim()
  const role = process.env.BAK_ROLE ?? 'EXECUTIVE'
  const facility = process.env.BAK_FACILITY_ID ?? 'demo-facility'
  const displayName = process.env.BAK_DISPLAY_NAME ?? `BAK ${staffId}`

  const id = normalizeStaffId(staffId)
  if (!id) {
    console.error('Refusing: set BAK_STAFF_ID env var. Nothing was created.')
    process.exit(1)
  }
  if (!/^\d{4,12}$/.test(pin)) {
    console.error('Refusing: BAK_PIN must be 4–12 digits. Nothing was created.')
    process.exit(1)
  }

  const email = `pin.${id}@${PIN_DOMAIN}`
  const password = `BAK-${pin}-PIN`
  let uid: string
  try {
    const existing = await auth.getUserByEmail(email)
    uid = existing.uid
    await auth.updateUser(uid, { password, displayName, disabled: false })
    console.log(`updated PIN login for Staff ID "${staffId}" (${email})`)
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'auth/user-not-found') {
      const created = await auth.createUser({ email, password, displayName, emailVerified: false })
      uid = created.uid
      console.log(`created PIN login for Staff ID "${staffId}" (${email})`)
    } else {
      throw err
    }
  }
  await auth.setCustomUserClaims(uid, { role, facilities: [facility] })
  console.log(`claims set: { role: ${role}, facilities: [${facility}] }. Hand the staffer their ID + PIN in person.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
