import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch, isLive, setToken, setRefreshToken } from '../lib/api'
import { restoreSessionLive } from '../lib/live'
import { useSession } from '../store/session'

const TIMEZONES = ['Africa/Harare', 'Africa/Johannesburg', 'Africa/Nairobi', 'Africa/Lagos', 'Africa/Kampala', 'Africa/Addis_Ababa', 'UTC']

/** Public new-company signup: org + first yard + admin account in one step.
 * Accepts `?invite=<token>` from a platform operator link to prefill the
 * invited email. Demo yards self-serve a trial; real yards stay operator-gated. */
export default function Signup() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const invite = params.get('invite') ?? ''
  const [orgName, setOrgName] = useState('')
  const [siteName, setSiteName] = useState('')
  const [timezone, setTimezone] = useState('Africa/Harare')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [demo, setDemo] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteState, setInviteState] = useState<'checking' | 'ok' | 'invalid' | 'none'>(invite ? 'checking' : 'none')
  const [busy, setBusy] = useState(false)
  const live = isLive()

  useEffect(() => {
    if (!invite) return
    let active = true
    void apiFetch<{ email: string }>(`/tenancy/signup-invites/${encodeURIComponent(invite)}/`)
      .then(data => { if (active) { setEmail(current => current || data.email); setInviteState('ok') } })
      .catch(() => { if (active) setInviteState('invalid') })
    return () => { active = false }
  }, [invite])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const data = await apiFetch<{ token: string; refresh_token?: string }>('/tenancy/signup/', {
        method: 'POST',
        body: {
          organisation_name: orgName.trim(), facility_name: siteName.trim() || 'Main Yard',
          facility_mode: demo ? 'DEMO' : 'OPERATIONS', facility_timezone: timezone,
          username: username.trim(), password, email: email.trim(),
          ...(invite ? { invite } : {}),
        },
      })
      setToken(data.token)
      setRefreshToken(data.refresh_token)
      const session = await restoreSessionLive()
      if (session) useSession.getState().signInReal(session.uid, session.role, session.displayName, session.baseRole)
      navigate('/onboarding')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b1526] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-white p-6 shadow-2xl" aria-label="Create your yard">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="gantry-mark flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl font-black text-slate-900">T</span>
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-amber-700">Trucki · Yard Operations</p>
              <h1 className="text-lg font-extrabold leading-tight tracking-tight">Create your yard</h1>
            </div>
          </div>
          {!live && (
            <p role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800">
              ✖ Yard system not connected. Signup needs a live backend.
            </p>
          )}
          {inviteState === 'invalid' && (
            <p role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900">
              This signup link expired or is invalid. You can still sign up below, or ask for a new link.
            </p>
          )}
          {inviteState === 'ok' && (
            <p className="mt-3 text-sm font-semibold text-emerald-800" role="status">Invited email pre-filled. Confirm the remaining details.</p>
          )}
          {live && (
            <form className="mt-4 space-y-3" onSubmit={submit}>
              <label className="block text-sm font-bold">Company name
                <input required maxLength={200} autoComplete="organization" className="field touch-target mt-1 w-full px-3" value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="Mhofu Logistics" />
              </label>
              <label className="block text-sm font-bold">First yard name
                <input maxLength={200} className="field touch-target mt-1 w-full px-3" value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="Main Yard" />
              </label>
              <label className="block text-sm font-bold">Yard timezone
                <select className="field touch-target mt-1 w-full" value={timezone} onChange={e => setTimezone(e.target.value)}>{TIMEZONES.map(tz => <option key={tz}>{tz}</option>)}</select>
              </label>
              <label className="block text-sm font-bold">Your email
                <input required type="email" autoComplete="email" className="field touch-target mt-1 w-full px-3" value={email} onChange={e => setEmail(e.target.value)} />
              </label>
              <label className="block text-sm font-bold">Admin username
                <input required maxLength={150} autoComplete="username" className="field touch-target mt-1 w-full px-3" value={username} onChange={e => setUsername(e.target.value)} />
              </label>
              <label className="block text-sm font-bold">Admin password
                <input required type="password" minLength={6} autoComplete="new-password" className="field touch-target mt-1 w-full px-3" value={password} onChange={e => setPassword(e.target.value)} />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 h-5 w-5" checked={demo} onChange={e => setDemo(e.target.checked)} />
                <span><strong>Training / demo yard.</strong> Setup completes immediately without platform approval. Uncheck for a real cargo yard — activation then needs operator approval.</span>
              </label>
              {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>}
              <button type="submit" disabled={busy} className="btn-primary touch-target w-full px-4 text-base">
                {busy ? 'Creating your yard…' : 'Create yard and start setup →'}
              </button>
              <p className="text-[11px] leading-snug text-slate-500">
                You become the company administrator. Operational screens unlock after the guided setup — including an independent review by a second person.
              </p>
            </form>
          )}
        </div>
        <p className="mt-3 text-center text-xs font-semibold text-white/60">
          Already have an account? <Link className="underline" to="/">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
