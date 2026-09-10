import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession, type Role } from '../store/session'
import { isLive } from '../lib/firebase'

/** Firebase speaks in codes — the yard team needs plain language. */
function friendlyAuthError(raw: string): string {
  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|INVALID_EMAIL|user-not-found/i.test(raw))
    return '✖ Email or password did not match. Check for typos, caps lock, or a trailing space from autofill — then try again.'
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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const live = isLive()
  const allowDemo = !import.meta.env.PROD

  async function signIn() {
    setBusy(true)
    setError(null)
    try {
      const { signInLive } = await import('../lib/live')
      const s = await signInLive(email.trim(), password)
      signInReal(s.uid, s.role, s.displayName)
      navigate('/queue')
    } catch (e) {
      setError(friendlyAuthError((e as Error).message))
    } finally {
      setBusy(false)
    }
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
                navigate('/queue')
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
