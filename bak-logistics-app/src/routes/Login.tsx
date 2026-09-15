import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession, type Role } from '../store/session'
import { isLive } from '../lib/firebase'
import { landingPathForRole } from '../lib/gates'
import { parsePinCredentials } from '../lib/pin'

/** Firebase speaks in codes — the yard team needs plain language. */
function friendlyAuthError(raw: string, pinMode = false): string {
  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|INVALID_EMAIL|user-not-found/i.test(raw))
    return pinMode
      ? '✖ Staff ID or PIN did not match. Check for typos — then try again.'
      : '✖ Email or password did not match. Check for typos, caps lock, or a trailing space from autofill — then try again.'
  if (/TOO_MANY_ATTEMPTS|too-many-requests/i.test(raw))
    return '✖ Too many attempts — wait a minute, then try once more carefully.'
  if (/NETWORK|network-request-failed/i.test(raw))
    return '⏳ Network problem — the yard Wi-Fi may be down. Work continues offline where supported.'
  if (/No role claim/i.test(raw)) return `✖ ${raw}`
  return `✖ ${raw}`
}

const ROLES: { value: Role; blurb: string }[] = [  { value: 'DISPATCH_SUPERVISOR', blurb: 'Gate: register + validate' },
  { value: 'OPERATIONS_SUPERVISOR', blurb: 'Yard: docks + overrides' },
  { value: 'FACILITY_MANAGER', blurb: 'Oversight + reports' },
  { value: 'EXECUTIVE', blurb: 'SLA + audit' },
  { value: 'COMPLIANCE_OFFICER', blurb: 'Audit trail' },
  { value: 'ADMIN', blurb: 'Setup + users' },
]

export default function Login() {
  const { signInDemo, signInReal } = useSession()
  const navigate = useNavigate()
  const [role, setRole] = useState<Role>('DISPATCH_SUPERVISOR')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [staffId, setStaffId] = useState('')
  const [pin, setPin] = useState('')
  const [mode, setMode] = useState<'pin' | 'email'>('pin')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const live = isLive()
  const allowDemo = !import.meta.env.PROD

  async function signInWith(emailValue: string, passwordValue: string, pinMode = false) {
    setBusy(true)
    setError(null)
    try {
      const { signInLive } = await import('../lib/live')
      const s = await signInLive(emailValue.trim(), passwordValue)
      signInReal(s.uid, s.role, s.displayName)
      navigate(landingPathForRole(s.role))
    } catch (e) {
      setError(friendlyAuthError((e as Error).message, pinMode))
    } finally {
      setBusy(false)
    }
  }

  async function signIn() {
    await signInWith(email, password)
  }

  async function signInPin() {
    let creds: { email: string; password: string }
    try {
      creds = parsePinCredentials(staffId, pin)
    } catch (e) {
      setError(`✖ ${(e as Error).message}`)
      return
    }
    await signInWith(creds.email, creds.password, true)
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-1">
      <div className="mb-4 flex items-center gap-3">
        <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-xl font-black text-amber-400">
          B
        </span>
        <div>
          <p className="text-lg font-extrabold leading-tight">BAK Intel</p>
          <p className="text-sm text-slate-600">Yard control for Harare shift teams</p>
        </div>
        <span className={`ml-auto ${live ? 'pill pill-live' : 'pill pill-demo'}`}>{live ? '● STAGING' : '■ DEMO'}</span>
      </div>
      <div className="card p-6">
        <h1 className="page-title">Gate sign-in</h1>
        {live ? (
          <>
            <p className="page-sub mt-1">Staging sign-in. Your role comes from your admin-set account.</p>
            <div className="mt-3 flex gap-1.5" role="group" aria-label="Sign-in method">
              {(['pin', 'email'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m)
                    setError(null)
                  }}
                  aria-pressed={mode === m}
                  className={`touch-target rounded-full px-3 text-sm font-bold ${mode === m ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}
                >
                  {m === 'pin' ? 'Shift PIN' : 'Email'}
                </button>
              ))}
            </div>
            {mode === 'pin' ? (
              <>
                <label className="mt-4 block text-sm font-bold" htmlFor="staffId">
                  Staff ID
                  <input id="staffId" type="text" autoComplete="username" placeholder="BAK-07-TAFADZWA" value={staffId} onChange={(e) => setStaffId(e.target.value.toUpperCase())} className="field touch-target mt-1 w-full px-3" autoCapitalize="characters" />
                </label>
                <label className="mt-3 block text-sm font-bold" htmlFor="pin">
                  PIN
                  <input id="pin" type="password" inputMode="numeric" autoComplete="current-password" placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))} className="field touch-target mt-1 w-full px-3" />
                </label>
                {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">✖ {error}</p>}
                <button type="button" onClick={signInPin} disabled={busy} className="btn-primary touch-target mt-4 w-full px-4 text-base">
                  {busy ? 'Signing in…' : 'Sign in to shift'}
                </button>
              </>
            ) : (
              <>
                <label className="mt-4 block text-sm font-bold" htmlFor="email">
                  Email
                  <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="field touch-target mt-1 w-full px-3" />
                </label>
                <label className="mt-3 block text-sm font-bold" htmlFor="password">
                  Password
                  <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="field touch-target mt-1 w-full px-3" />
                </label>
                {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">✖ {error}</p>}
                <button type="button" onClick={signIn} disabled={busy} className="btn-primary touch-target mt-4 w-full px-4 text-base">
                  {busy ? 'Signing in…' : 'Sign in to shift'}
                </button>
              </>
            )}
          </>
        ) : allowDemo ? (
          <>
            <p className="page-sub mt-1">Demo mode — pick the job you are covering this shift.</p>
            <label className="mt-4 block text-sm font-bold" htmlFor="role">
              Shift role
            </label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="field touch-target mt-1 w-full px-3"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.value.replace(/_/g, ' ')} — {r.blurb}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-primary touch-target mt-4 w-full px-4 text-base"
              onClick={() => {
                signInDemo(role)
                navigate(landingPathForRole(role))
              }}
            >
              Start shift →
            </button>
          </>
        ) : (
          <p role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800">
            ✖ Backend not configured in this production build. Sign-in is disabled — ask an ADMIN to set
            VITE_FIREBASE_* env vars. No yard data is stored in this state.
          </p>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-slate-600">Works offline in the yard · Queued work syncs on reconnect</p>
    </div>
  )
}
