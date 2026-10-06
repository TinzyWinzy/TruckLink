import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession, roleFromSlug, type Role } from '../store/session'
import { isLive } from '../lib/api'
import { landingPathForRole } from '../lib/gates'

/** Backend speaks plain errors — map them to yard language. */
function friendlyAuthError(raw: string, pinMode = false): string {
  if (/invalid credentials/i.test(raw))
    return pinMode
      ? '✖ Staff ID or PIN did not match. Check for typos. Then try again.'
      : '✖ Email or password did not match. Check for typos, caps lock, or a trailing space from autofill. Then try again.'
  if (/no job assigned/i.test(raw)) return `✖ ${raw}`
  if (/Network unreachable|network/i.test(raw))
    return '⏳ Network problem. The yard Wi-Fi may be down. Work continues offline where supported.'
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
  // Test hatch: demo tabs are dev-only by default (prod stays fail-closed).
  // Force them with VITE_ALLOW_DEMO=true (build-time) or ?demo=1 (URL, test only).
  const demoHatch =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')
  const allowDemo = !import.meta.env.PROD || import.meta.env.VITE_ALLOW_DEMO === 'true' || demoHatch
  const online = typeof navigator === 'undefined' ? true : navigator.onLine
  const { role: activeRole } = useSession()

  // Econet-style deep link: ?demo=1&role=dispatch signs straight into the
  // practice shift — the shareable validation link for the gatekeeper. Test-only:
  // practice sessions never touch yard data.
  useEffect(() => {
    if (!allowDemo) return
    const slug = roleFromSlug(new URLSearchParams(window.location.search).get('role'))
    if (slug && slug !== activeRole) {
      signInDemo(slug)
      navigate(landingPathForRole(slug))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function signInWith(value: string, secret: string, pinMode = false) {
    setBusy(true)
    setError(null)
    try {
      const live = await import('../lib/live')
      const s = pinMode
        ? await live.signInPinLive(value, secret)
        : await live.signInLive(value, secret)
      signInReal(s.uid, s.role, s.displayName, s.baseRole)
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
    const id = staffId.trim().toUpperCase()
    const digits = pin.trim()
    if (!id) {
      setError('✖ Enter your Staff ID (e.g. TRK-07-DEMO).')
      return
    }
    if (!/^\d{4,12}$/.test(digits)) {
      setError('✖ PIN must be 4–12 digits.')
      return
    }
    await signInWith(id, digits, true)
  }

  function demoTabsBlock() {
    return (
      <>
        <div role="radiogroup" aria-label="Shift role">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ROLES.map((r) => {
              const selected = role === r.value
              return (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setRole(r.value)}
                  className={`touch-target rounded-xl border-2 px-3 py-2 text-left transition-colors ${
                    selected
                      ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                      : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-extrabold tracking-tight">
                    <span aria-hidden="true" className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${selected ? 'bg-amber-400 text-slate-900' : 'bg-slate-100 text-slate-500'}`}>
                      {selected ? '●' : '○'}
                    </span>
                    {r.value.replace(/_/g, ' ')}
                  </span>
                  <span className={`mt-0.5 block text-xs ${selected ? 'text-white/75' : 'text-slate-500'}`}>{r.blurb}</span>
                </button>
              )
            })}
          </div>
        </div>
        {error && !live && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}
        <button
          type="button"
          className="btn-primary touch-target mt-4 w-full px-4 text-base"
          onClick={() => {
            signInDemo(role)
            navigate(landingPathForRole(role))
          }}
        >
          Start shift as {role.replace(/_/g, ' ')} →
        </button>
        <p className="mt-3 text-[11px] leading-snug text-slate-500">
          Practice sign-in. Training only. Yard sign-in uses real accounts; jobs come from your supervisor.
        </p>
      </>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b1526] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-white p-6 shadow-2xl" aria-label="Gate sign-in">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="gantry-mark flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl font-black text-slate-900">
              T
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-amber-700">Trucki · Yard Operations</p>
              <h1 className="text-lg font-extrabold leading-tight tracking-tight">Gate sign-in</h1>
            </div>
            <span className={`ml-auto shrink-0 ${live ? 'pill pill-live' : 'pill pill-demo'}`}>{live ? '● LIVE' : '■ PRACTICE'}</span>
          </div>

          <div className="tnum mt-3 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600" role="status">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {online ? 'Online' : 'Offline. Queued work syncs on reconnect'}
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>{live ? 'Shift PIN or email' : 'Practice. Pick a shift role'}</span>
          </div>

          {live ? (
            <>
              <div className="mt-4 flex items-center gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label="Sign-in method">
                {(['pin', 'email'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setMode(m)
                      setError(null)
                    }}
                    aria-pressed={mode === m}
                    className={`touch-target flex-1 rounded-lg px-3 text-sm font-extrabold transition-colors ${mode === m ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    {m === 'pin' ? 'Shift PIN' : 'Email'}
                  </button>
                ))}
              </div>
              {mode === 'pin' ? (
                <>
                  <label className="mt-4 block text-sm font-bold" htmlFor="staffId">
                    Staff ID
                    <input id="staffId" type="text" autoComplete="username" autoFocus placeholder="TRK-07-DEMO" value={staffId} onChange={(e) => setStaffId(e.target.value.toUpperCase())} className="field touch-target mt-1 w-full px-3 text-center font-data tracking-[0.12em]" autoCapitalize="characters" />
                  </label>
                  <label className="mt-3 block text-sm font-bold" htmlFor="pin">
                    PIN
                    <input id="pin" type="password" inputMode="numeric" autoComplete="current-password" placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))} className="field touch-target tnum mt-1 w-full px-3 text-center text-2xl tracking-[0.5em]" />
                  </label>
                  {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}
                  <button type="button" onClick={signInPin} disabled={busy} className="btn-primary touch-target mt-4 w-full px-4 text-base">
                    {busy ? 'Signing in…' : 'Sign in to shift'}
                  </button>
                  <p className="mt-3 text-[11px] leading-snug text-slate-500">
                    Pilot-grade PIN. Too many wrong tries locks briefly, and yard actions still need your assigned job. Never share PINs; lost PINs go to your supervisor.
                  </p>
                  {allowDemo && (
                    <div className="mt-5 border-t border-slate-200 pt-4">
                      <p className="eyebrow">Practice sign-in · training only</p>
                      <p className="page-sub mt-1">Skip sign-in. Jump in as any shift role. Nothing here touches the yard.</p>
                      <div className="mt-3">{demoTabsBlock()}</div>
                    </div>
                  )}
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
                  {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}
                  <button type="button" onClick={signIn} disabled={busy} className="btn-primary touch-target mt-4 w-full px-4 text-base">
                    {busy ? 'Signing in…' : 'Sign in to shift'}
                  </button>
                  {allowDemo && (
                    <div className="mt-5 border-t border-slate-200 pt-4">
                      <p className="eyebrow">Practice sign-in · training only</p>
                      <p className="page-sub mt-1">Skip sign-in. Jump in as any shift role. Nothing here touches the yard.</p>
                      <div className="mt-3">{demoTabsBlock()}</div>
                    </div>
                  )}
                </>
              )}
            </>
          ) : allowDemo ? (
            <>
              <p className="page-sub mt-3">Practice mode. Pick the job you are covering this shift.</p>
              <div className="mt-3">{demoTabsBlock()}</div>
            </>
          ) : (
            <p role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800">
              ✖ Yard system not connected. Ask your supervisor to connect this tablet. Nothing is saved in this state.
            </p>
          )}
        </div>
        <p className="mt-3 text-center text-xs font-semibold text-white/60">Works offline in the yard · Queued work syncs on reconnect</p>
      </div>
    </div>
  )
}
