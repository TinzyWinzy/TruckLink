import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { canVisit } from '../lib/gates'
import { apiFetch } from '../lib/api'
import { useLive } from '../lib/liveGate'
import { useSession } from '../store/session'
import { dashboardCsv, fetchDashboard, type Dashboard, type DashboardWindow } from '../lib/dashboard'
import { practiceDashboard } from '../lib/dashboardPractice'
import { practiceVisits } from '../lib/reportPracticeVisits'
import { queueToCsv } from '../lib/live'
import { PageHeader, Stat } from '../components/ui'
import { DashboardCharts } from '../components/DashboardCharts'
import MovementWorklist from '../components/MovementWorklist'
import { tenantDisplayName } from '../lib/tenant'

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
  URL.revokeObjectURL(url)
}

export default function Reports() {
  const { userId, role, workspace } = useSession()
  const live = useLive()
  const [window, setWindow] = useState<DashboardWindow>('24h')
  const [retry, setRetry] = useState(0)
  return <ReportsWorkspace key={`${live}:${userId}:${role}:${workspace?.selectedFacility}:${window}:${retry}`} window={window} onWindow={setWindow} onRetry={()=>setRetry(n=>n+1)} />
}

function ReportsWorkspace({ window, onWindow, onRetry }: { window: DashboardWindow; onWindow: (window: DashboardWindow)=>void; onRetry: ()=>void }) {
  const live = useLive()
  const { userId, role, workspace } = useSession()
  const facility = workspace?.selectedFacility ?? ''
  const [data, setData] = useState<Dashboard | null>(()=>live?null:practiceDashboard(window))
  const [error, setError] = useState(()=>live&&!facility?'Select an assigned yard to view its dashboard.':'')
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const [receivedAt, setReceivedAt] = useState<number | null>(null)
  const [clock, setClock] = useState(()=>Date.now())
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  useEffect(() => { pausedRef.current = paused }, [paused])

  useEffect(() => {
    if (!live || !facility) return
    let active = true, inFlight = false
    let request: AbortController | null = null
    const tick = async () => {
      if (!active || inFlight || pausedRef.current || document.hidden) return
      inFlight = true
      request = new AbortController()
      const timeout = globalThis.setTimeout(() => request?.abort(), 12000)
      try {
        const snapshot = await fetchDashboard(facility, window, request.signal)
        if (active && !pausedRef.current) { setData(snapshot); setReceivedAt(Date.now()); setError('') }
      } catch (e) {
        if (active && !pausedRef.current) setError(request.signal.aborted ? 'Dashboard request timed out. Retry when connected.' : (e as Error).message)
      } finally { globalThis.clearTimeout(timeout); inFlight = false }
    }
    void tick()
    const interval = globalThis.setInterval(() => { setClock(Date.now()); void tick() }, 5000)
    const visible = () => { if (!document.hidden) void tick() }
    document.addEventListener('visibilitychange', visible)
    return () => { active = false; request?.abort(); globalThis.clearInterval(interval); document.removeEventListener('visibilitychange', visible) }
  }, [live, userId, facility, window])

  const loading = live && !data && !error
  const stale = live && !!data && (!!error || paused || receivedAt == null || clock-receivedAt > 15000)
  const unavailable = !data || !!error || stale
  const currentYard = workspace?.facilities.find(f => String(f.id) === facility)
  const counts = data?.summary
  const occupied = data?.docks?.OCCUPIED ?? 0
  const dockTotal = data?.docks ? Object.values(data.docks).reduce((a,b)=>a+b,0) : null
  const ageing = data?.age_buckets.slice(2).reduce((n,b)=>n+b.count,0) ?? 0
  const title = error ? 'Operational data needs attention' : loading ? 'Waiting for operational evidence' : counts?.blocked ? `${counts.blocked} ${counts.blocked===1?'movement needs':'movements need'} controlled review` : ageing ? `${ageing} active ${ageing===1?'visit has':'visits have'} exceeded one hour` : 'Review the current shift'
  const updated = data ? new Intl.DateTimeFormat(undefined, { timeZone:data.facility.timezone, hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short' }).format(new Date(data.as_of)) : null

  async function exportVisits() {
    if (!data) return
    setExportError(''); setExporting(true)
    try {
      const csv = live ? await apiFetch<string>(`/reports/export.csv?facility=${encodeURIComponent(facility)}`, { responseType:'text' }) : queueToCsv(practiceVisits)
      download(csv, `trk-turnaround-${new Date().toISOString().slice(0,10)}.csv`)
    } catch (e) { setExportError((e as Error).message) }
    finally { setExporting(false) }
  }

  return <div className="reports-workspace space-y-6">
    <PageHeader title="Shift performance" sub={live ? 'Live yard activity, exceptions and movement handoffs.' : 'Synthetic practice dashboard. These figures are not measured performance.'}
      mode={live ? undefined : 'demo'} actions={<button type="button" onClick={exportVisits} className="btn-secondary px-4 text-sm" disabled={unavailable || exporting}>{exporting?'Exporting…':'Export CSV'}</button>} />
    {exportError && <p role="alert">Export failed: {exportError}</p>}
    <div className="intel-toolbar">
      <div><strong>{live?tenantDisplayName(workspace?.configuration,workspace?.organisation?.name):'Practice workspace'}</strong><span> / {currentYard?.name ?? (live?'Assigned yard':'Training yard')}</span>
        <p className={`intel-freshness ${stale || error?'intel-stale':''}`} role="status">{!live ? 'Synthetic practice data' : error ? 'Read failed. Last snapshot may be stale.' : paused ? 'Auto-refresh paused' : loading ? 'Loading dashboard…' : `Updated ${updated} · polls every 5 seconds`}</p>
      </div>
      <div className="intel-controls"><label>Chart window<select aria-label="Chart window" value={window} onChange={e=>onWindow(e.target.value as DashboardWindow)}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
        {live && <button className="btn-secondary px-3" onClick={()=>setPaused(p=>!p)}>{paused?'Resume updates':'Pause updates'}</button>}
        <button className="btn-secondary px-3" onClick={onRetry} disabled={paused}>Refresh now</button>
      </div>
    </div>
    {error && <div className="intel-error" role="alert"><strong>Dashboard unavailable</strong><p>{error}</p><button className="btn-secondary px-3 mt-3" onClick={onRetry}>Retry dashboard</button></div>}
    <section className={`report-priority ${counts?.blocked && !unavailable?'priority-blocked':''}`} aria-label="Review priority">
      <div><p className="text-sm font-semibold">Needs attention</p><h2>{title}</h2><p className="mt-2 text-sm">{unavailable ? 'Use a fresh snapshot before making an operational decision.' : counts?.blocked ? 'Resolve missing records and independent reviews from the movement worklist.' : 'Elapsed time indicates age, not the cause of a delay or permission to release.'}</p></div>
      {canVisit('queue',role) && <Link className="btn-secondary inline-flex items-center justify-center px-4" to="/queue">Open shift queue →</Link>}
    </section>
    {canVisit('dispatch',role)&&<MovementWorklist attention />}
    <div className="report-metric-strip">
      <Stat label="Active in yard" value={data?String(counts!.active):'Awaiting data'} unavailable={unavailable} hint="All recorded active visits, including older arrivals" />
      <Stat label="Recorded arrivals" value={data?String(counts!.arrivals):'Awaiting data'} unavailable={unavailable} hint="Arrivals in the selected chart window" />
      <Stat label="Physical exits" value={data?String(counts!.physical_exits):'Awaiting data'} unavailable={unavailable} hint="Valid separate exit milestones in the selected window" />
      <Stat label="Turnaround avg" value={data?(counts!.mean_turnaround_minutes==null?'No physical exits':`${Math.round(counts!.mean_turnaround_minutes)}m`):'Awaiting data'} unavailable={unavailable || counts?.mean_turnaround_minutes==null} hint={`${counts?.physical_exits??0} physical exits · legacy completion proxies excluded`} />
    </div>
    {loading && <div className="intel-loading" role="status">Loading activity graphs and source coverage…</div>}
    {data && <div className={stale?'intel-stale-charts':''} aria-label={stale?'Last recorded dashboard snapshot':'Current dashboard graphs'}>
      {stale && <p className="intel-stale-banner" role="status">{paused?'Updates paused.':'Snapshot may be stale.'} Charts show the last successful read at {updated}.</p>}
      <DashboardCharts data={data} showDocks={workspace?.configuration?.modules?.docks!==false} showAlerts={workspace?.configuration?.modules?.yard!==false} />
    </div>}
    <section className="report-panel" aria-label="Data availability">
      <div className="report-section-heading"><h2>Data availability</h2><span>Source coverage</span></div>
      <div className="report-source-list">
        <div><strong>Yard movements</strong><span>{!live?'Practice dataset':error?'Read failed':data?`${counts!.active} active movements loaded; ${counts!.arrivals} arrivals in chart window`:'Awaiting first read'}</span></div>
        <div><strong>Dock occupancy</strong><span>{!data?'Awaiting first read':data.docks==null?'Read not permitted':dockTotal?`${occupied} occupied / ${dockTotal} configured`:'No configured docks'}</span></div>
        <div><strong>ERP / tracker</strong><span>{!live?'No live sources connected':'Not configured. Graphs use recorded yard events.'}</span></div>
      </div>
      {data && <details className="operational-details mt-3"><summary>Definitions, exclusions and export</summary><p className="mt-2">{data.coverage.active_scope} {data.coverage.exit_scope}</p><p className="mt-2">{data.coverage.legacy_completions_excluded} legacy completion records and {data.coverage.invalid_exit_timestamps} invalid exit timestamps excluded from physical-exit metrics. {data.coverage.future_arrivals_excluded} future arrivals excluded.</p><p className="mt-2">Snapshot: {data.as_of}. Metric version: {data.metric_version}. {data.coverage.source}</p><p className="mt-2">Dock occupancy is a current snapshot, not time-based utilisation. Open alerts are unacknowledged records, not a complete count of operational exceptions. Historical counts may change when late observations are recorded.</p><p className="mt-2">Export CSV downloads visit records for this yard. Chart CSV downloads aggregated counts for the selected window.</p><button className="btn-secondary px-3 mt-3" disabled={unavailable} onClick={()=>download(dashboardCsv(data),`trucki-activity-${window}.csv`)}>Export chart CSV</button></details>}
      <div className="flex gap-4 flex-wrap mt-3">{canVisit('audit',role)&&<Link className="report-text-link" to="/audit">Inspect audit evidence</Link>}{canVisit('modelling',role)&&<Link className="report-text-link" to="/modelling">Explore synthetic modelling</Link>}</div>
    </section>
  </div>
}
