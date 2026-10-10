import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { canVisit, type RouteKey } from '../lib/gates'
import { useLive } from '../lib/liveGate'
import { fetchDashboard, type Dashboard } from '../lib/dashboard'
import { practiceDashboard } from '../lib/dashboardPractice'
import { isPracticeSession, useSession } from '../store/session'
import { PageHeader, Stat } from '../components/ui'

type WorkspaceData = {
  organisation: { id: number; name: string }
  facility: { id: number; name: string }
  role: string
  as_of: string
  activation_required: boolean
  notice: string
  cards: { key: string; module: string; title: string; description: string; href: string }[]
}

export default function Workspace() {
  const { workspace, role, userId } = useSession()
  const facility = workspace?.selectedFacility ?? ''
  const practice = isPracticeSession(userId)
  const live = useLive()
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [requestError, setError] = useState('')
  const [reload, setReload] = useState(0)
  const error = requestError || (!practice && !facility ? 'Select an assigned workspace.' : '')

  useEffect(() => {
    let active = true
    if (practice || !facility) return
    void apiFetch<WorkspaceData>(`/tenant/workspace/?facility=${encodeURIComponent(facility)}`)
      .then(value => {
        if (!active) return
        if (value.facility.id !== Number(facility) || value.organisation.id !== workspace?.organisation?.id || value.role !== role) {
          throw new Error('Workspace scope changed. Reload your session.')
        }
        setData(value)
      })
      .catch(e => {
        if (active) setError((e as Error).message)
      })
    return () => { active = false }
  }, [facility, workspace?.organisation?.id, role, reload, practice])

  const activityEnabled = canVisit('reports', role) && (practice || !!data?.cards.some(card => card.key === 'graphs'))
  return <div className="space-y-6">
    <PageHeader title="Your workspace" sub="Capabilities configured for your company, role and assigned site." />
    {practice && <p className="card p-5">Practice mode uses synthetic scenarios. Tenant subscriptions apply to signed-in company workspaces. <Link className="report-text-link" to="/guide">Open the walkthrough guide</Link></p>}
    {!practice && !data && !error && <p role="status">Loading your workspace…</p>}
    {error && <div className="card p-5" role="alert"><p>{error}</p><button className="btn-secondary mt-3 px-4" onClick={() => { setError(''); setData(null); setReload(n => n + 1) }}>Retry workspace</button></div>}
    {data && <>
      <p className="text-sm font-semibold">{data.organisation.name} / {data.facility.name} · {data.role.replaceAll('_', ' ')}</p>
      {data.activation_required && <section className="card p-5" aria-label="Setup status">
        <h2 className="text-lg font-bold">Setup in progress</h2>
        <p className="mt-1">Your workspace is ready to explore. Operational actions unlock after the required review and release activation.</p>
        {role === 'ADMIN' && <Link className="btn-primary mt-4 inline-flex px-4" to="/onboarding">Continue setup</Link>}
      </section>}
      {activityEnabled && <WorkspaceActivity facility={facility} live={!practice && live} />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data.cards.filter(card => canVisit(card.href.slice(1) as RouteKey, role)).map(card => <Link key={card.key} className="card block p-5 hover:border-blue-400 focus-visible:outline-2" to={card.href}><h2 className="text-lg font-bold">{card.title}</h2><p className="mt-2 text-sm text-slate-600">{card.description}</p><span className="report-text-link mt-4 inline-block">Open →</span></Link>)}</div>
      {!data.cards.length && <p className="card p-5">No operational modules are available for this role and site. Ask the tenant administrator to review access.</p>}
      <p className="text-sm text-slate-600">{data.notice}</p>
    </>}
    {practice && activityEnabled && <WorkspaceActivity facility="" live={false} />}
  </div>
}

function WorkspaceActivity({ facility, live }: { facility: string; live: boolean }) {
  const [data, setData] = useState<Dashboard | null>(() => live ? null : practiceDashboard('24h'))
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  const [receivedAt, setReceivedAt] = useState<number | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!live || !facility) return
    let active = true
    let inFlight = false
    let request: AbortController | null = null
    const tick = async () => {
      if (!active || inFlight || paused || document.hidden) return
      inFlight = true
      const controller = new AbortController()
      request = controller
      const timeout = globalThis.setTimeout(() => controller.abort(), 12000)
      try {
        const snapshot = await fetchDashboard(facility, '24h', controller.signal)
        if (active && !paused) {
          setData(snapshot)
          setReceivedAt(Date.now())
          setError('')
        }
      } catch (e) {
        if (active && !paused) setError(controller.signal.aborted ? 'Dashboard request timed out. Retry when connected.' : (e as Error).message)
      } finally {
        globalThis.clearTimeout(timeout)
        inFlight = false
      }
    }
    void tick()
    const interval = globalThis.setInterval(() => { setClock(Date.now()); void tick() }, 5000)
    const visible = () => { if (!document.hidden) void tick() }
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      request?.abort()
      globalThis.clearInterval(interval)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [live, facility, paused, retry])

  const loading = live && !data && !error
  const stale = live && !!data && (!!error || paused || receivedAt == null || clock - receivedAt > 15000)
  const unavailable = !data || !!error || stale
  const updated = data ? new Intl.DateTimeFormat(undefined, {
    timeZone: data.facility.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  }).format(new Date(data.as_of)) : null

  return <section className="card space-y-4 p-5" aria-label="Activity snapshot">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold">Activity at a glance</h2>
        <p className="text-sm text-slate-600">{live ? 'Recorded activity for the last 24 hours.' : 'Synthetic practice snapshot — not live customer data.'}</p>
        <p className={`mt-1 text-sm ${error || stale ? 'text-amber-700' : 'text-slate-600'}`} role="status">
          {!live ? 'Synthetic practice data' : error ? 'Refresh failed; the last snapshot may be stale.' : paused ? 'Auto-refresh paused' : loading ? 'Loading activity…' : `Updated ${updated} · refreshes every 5 seconds`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {live && <button type="button" className="btn-secondary px-3" onClick={() => setPaused(value => !value)}>{paused ? 'Resume updates' : 'Pause updates'}</button>}
        {live && <button type="button" className="btn-secondary px-3" onClick={() => setRetry(value => value + 1)} disabled={paused}>Refresh now</button>}
        <Link className="btn-secondary inline-flex items-center px-3" to="/reports">Open activity report →</Link>
      </div>
    </div>
    {error && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p>{error}</p>
      <button type="button" className="report-text-link mt-2" onClick={() => setRetry(value => value + 1)} disabled={paused}>Retry activity</button>
    </div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Active in yard" value={data ? String(data.summary.active) : 'Awaiting data'} unavailable={unavailable} hint="Recorded active visits" />
      <Stat label="Recorded arrivals" value={data ? String(data.summary.arrivals) : 'Awaiting data'} unavailable={unavailable} hint="Arrivals in the last 24 hours" />
      <Stat label="Physical exits" value={data ? String(data.summary.physical_exits) : 'Awaiting data'} unavailable={unavailable} hint="Valid recorded yard exits" />
      <Stat label="Needs review" value={data ? String(data.summary.blocked) : 'Awaiting data'} tone={data?.summary.blocked ? 'alert' : 'plain'} unavailable={unavailable} hint="Blocked or pending independent review" />
    </div>
  </section>
}
