/**
 * Staging test-user provisioning (UAT credentials).
 * Creates one test account per shift role with custom claims
 * { role, facilities: [FACILITY] } so Firestore rules + Login work end-to-end.
 *
 * Prerequisites:
 *  1. Firebase console → radbit-bak-staging → Authentication → Sign-in method
 *     → enable "Email/Password".
 *  2. GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account key with
 *     Firebase Admin rights (or run via `firebase login` ADC).
 *
 * Usage (PowerShell):
 *   $env:BAK_TEST_PASSWORD="Choose-A-Strong-Password"
 *   $env:BAK_FACILITY_ID="demo-facility"
 *   npm run seed:users --workspace=functions  # or: npm --prefix functions run seed:users
 *
 * Password is NEVER stored in the repo — it comes from the env var only.
 */
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

initializeApp()
const auth = getAuth()

const FACILITY = process.env.BAK_FACILITY_ID ?? 'demo-facility'
const PASSWORD = process.env.BAK_TEST_PASSWORD

const ROLES = [
  'DISPATCH_SUPERVISOR',
  'OPERATIONS_SUPERVISOR',
  'FACILITY_MANAGER',
  'EXECUTIVE',
  'COMPLIANCE_OFFICER',
  'ADMIN',
] as const

function emailFor(role: string): string {
  return `bak.test.${role.toLowerCase().replace(/_/g, '.')}@radbit.studio`
}

async function main(): Promise<void> {
  if (!PASSWORD || PASSWORD.length < 12) {
    console.error('Refusing: set BAK_TEST_PASSWORD env var (min 12 chars). Nothing was created.')
    process.exit(1)
  }
  for (const role of ROLES) {
    const email = emailFor(role)
    let uid: string
    try {
      const existing = await auth.getUserByEmail(email)
      uid = existing.uid
      await auth.updateUser(uid, { password: PASSWORD, displayName: `BAK Test ${role.replace(/_/g, ' ')}`, disabled: false })
      console.log(`updated ${email}`)
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'auth/user-not-found') {
        const created = await auth.createUser({
          email,
          password: PASSWORD,
          displayName: `BAK Test ${role.replace(/_/g, ' ')}`,
          emailVerified: false,
        })
        uid = created.uid
        console.log(`created ${email}`)
      } else {
        throw err
      }
    }
    await auth.setCustomUserClaims(uid, { role, facilities: [FACILITY] })
  }
  console.log(`Done: 6 test users, facility "${FACILITY}". Rotate BAK_TEST_PASSWORD after UAT.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
