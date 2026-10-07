import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { canVisit } from '../lib/gates'
import { facilityId } from '../lib/api'
import { useLive } from '../lib/liveGate'
import { useSession } from '../store/session'
import { computeTurnaroundStats, queueToCsv, type LiveRow } from '../lib/live'
import {
  fetchHeatmap,
  fetchSurge,
  isAnalyticsLive,
  type HeatmapBucket,
  type SurgeStatus,
} from '../lib/analytics'
import { EmptyState, PageHeader, Stat } from '../components/ui'
import MovementWorklist from '../components/MovementWorklist'
import {tenantDisplayName} from '../lib/tenant'

const SEED: LiveRow[] = [
  { id: 'q1', licensePlate: 'AEH 4521', driverName: 'T. Moyo', cargoType: 'Container', expectedDestination: 'Beitbridge', status: 'QUEUED', entryTimestamp: new Date(Date.now() - 42 * 60000).toISOString() },
  { id: 'q2', licensePlate: 'AGX 9033', driverName: 'S. Ndlovu', cargoType: 'Dry van', expectedDestination: 'Forbes', status: 'ASSIGNED', entryTimestamp: new Date(Date.now() - 25 * 60000).toISOString() },
  { id: 'q3', licensePlate: 'AFM 1187', driverName: 'K. Sibanda', cargoType: 'Tanker', expectedDestination: 'Chirundu', status: 'QUARANTINED', entryTimestamp: new Date(Date.now() - 169 * 60000).toISOString() },
  { id: 'q4', licensePlate: 'ABZ 9901', driverName: 'R. Dube', cargoType: 'Container', expectedDestination: 'Beitbridge', status: 'QUEUED', entryTimestamp: new Date(Date.now() - 74 * 60000).toISOString() },
  { id: 'q5', licensePlate: 'AEO 2210', driverName: 'P. Chikafu', cargoType: 'Refrigerated', expectedDestination: 'Harare Local', status: 'RELEASED', entryTimestamp: new Date(Date.now() - 180 * 60000).toISOString(), exitTimestamp: new Date(Date.now() - 95 * 60000).toISOString() },
  { id: 'q6', licensePlate: 'ADP 3357', driverName: 'J. Banda', cargoType: 'Flatbed', expectedDestination: 'Chirundu', status: 'PENDING_OVERRIDE', entryTimestamp: new Date(Date.now() - 86 * 60000).toISOString() },
  { id: 'q7', licensePlate: 'AEW 7712', driverName: 'M. Hove', cargoType: 'Dry van', expectedDestination: 'Forbes', status: 'OVERRIDE_APPROVED', entryTimestamp: new Date(Date.now() - 139 * 60000).toISOString() },
  { id: 'q8', licensePlate: 'AFX 6640', driverName: 'D. Mutasa', cargoType: 'Container', expectedDestination: 'Beitbridge', status: 'QUEUED', entryTimestamp: new Date(Date.now() - 9 * 60000).toISOString() },
]

const fmt = (n: number | null) => (n == null ? 'N/A' : `${Math.round(n)}m`)

export default function Reports() {
  const live = useLive()
  const { userId, role, workspace } = useSession()
  const [lastRead, setLastRead] = useState<Date | null>(null)
  const [rows, setRows] = useState<LiveRow[]>(() => live ? [] : SEED)
  const [retry, setRetry] = useState(0)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [docks, setDocks] = useState<LiveRow[]>([])
  const [docksRead, setDocksRead] = useState(false)
  const [docksError, setDocksError] = useState<string|null>(null)
  const [heatmap, setHeatmap] = useState<HeatmapBucket[] | null>(null)
  const [surge, setSurge] = useState<SurgeStatus | null>(null)
  const analytics = live && isAnalyticsLive()

  useEffect(() => {
    if (!live) return
    let cancelled = false
    let u1: (() => void) | undefined
    let u2: (() => void) | undefined
    import('../lib/live').then((m) => {
      if (cancelled) return
      u1 = m.subscribe('queue', (records) => { setRows(records); setLastRead(new Date()) }, 500, setFeedError) ?? undefined
      u2 = m.subscribe('docks', records=>{setDocks(records);setDocksRead(true)}, 100, setDocksError) ?? undefined
    })
    return () => {
      cancelled = true
      u1?.()
      u2?.()
    }
  }, [live, userId, retry])

  useEffect(() => {
    if (!analytics) return
    let cancelled = false
    Promise.all([fetchHeatmap(facilityId), fetchSurge(facilityId)]).then(
      ([h, s]) => {
        if (cancelled) return
        if (h) setHeatmap(h.buckets)
        if (s) setSurge(s)
      },
    ).catch(() => {
      // Offline or server unreachable. Sections below stay in empty states.
    })
    return () => {
      cancelled = true
    }
  }, [analytics, userId])

  const stats = useMemo(() => computeTurnaroundStats(rows), [rows])
  const dockUtil = useMemo(() => {
    if (docks.length === 0) return null
    const occ = docks.filter((d) => String(d.status) === 'OCCUPIED').length
    return Math.round((occ / docks.length) * 100)
  }, [docks])

  function downloadCsv() {
    const blob = new Blob([queueToCsv(rows)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trk-turnaround-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const awaitingData = live && !lastRead
  const blocked = (stats.byStatus.QUARANTINED ?? 0) + (stats.byStatus.PENDING_OVERRIDE ?? 0)
  const currentYard = workspace?.facilities.find(f => String(f.id) === workspace.selectedFacility)
  const reviewTitle = feedError ? 'Restore the operational feed' : awaitingData ? 'Waiting for operational evidence' : stats.total === 0 ? 'Build the first operational baseline' : blocked > 0 ? `${blocked} ${blocked===1?'movement needs':'movements need'} controlled review` : stats.overdueCount > 0 ? `${stats.overdueCount} ${stats.overdueCount===1?'movement exceeds':'movements exceed'} the wait threshold` : 'Review the current shift'

  const unavailable = awaitingData || !!feedError
  return <div className="reports-workspace space-y-6">
    <PageHeader title="Shift performance"
      sub={live ? 'Resolve movement handoffs, then review the shift.' : 'Synthetic practice records. Explore the workflow without changing live operations.'}
      mode={live ? undefined : 'demo'} actions={<button type="button" onClick={downloadCsv} className="btn-secondary px-4 text-sm" disabled={awaitingData || !!feedError}>Export CSV</button>} />
    <div className="report-context" aria-label="Report context">
      <span><strong>{live?tenantDisplayName(workspace?.configuration,workspace?.organisation?.name):'Practice workspace'}</strong> / {currentYard?.name ?? 'Training yard'}</span>
      <span>{live ? lastRead ? `Last successful read ${lastRead.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Connecting to assigned yard' : 'Synthetic practice records'}</span>
    </div>
    <section className={`report-priority ${blocked && !unavailable ? 'priority-blocked' : ''}`} aria-label="Review priority">
      <div><p className="text-sm font-semibold">Needs attention</p><h2>{reviewTitle}</h2>
      <p className="mt-2 text-sm">{feedError ? 'Figures are unavailable until the operational feed recovers.' : awaitingData ? 'Loading the assigned yard…' : blocked ? 'Open the movement to resolve its missing records and reviews.' : stats.overdueCount ? 'Review the oldest handoffs and their accountable owners.' : stats.total ? 'Continue the next handoff from the worklist.' : 'Register an observed arrival to begin.'}</p></div>
      {feedError ? <button className="btn-primary px-4" onClick={()=>{setLastRead(null);setFeedError(null);setRows([]);setRetry(n=>n+1)}}>Retry operational feed</button> : canVisit('queue',role) && <Link className="btn-secondary inline-flex items-center justify-center px-4" to="/queue">Open shift queue →</Link>}
    </section>
    <MovementWorklist attention />
    <div className="report-metric-strip">
      <Stat label="Overdue > 60m" value={unavailable ? 'Awaiting data' : String(stats.overdueCount)} unavailable={unavailable} tone={!unavailable && stats.overdueCount > 0 ? 'alert' : 'plain'} hint="Active movements above the waiting threshold" />
      <Stat label="Waiting now" value={unavailable ? 'Awaiting data' : fmt(stats.avgWaitMinutes)} unavailable={unavailable || stats.avgWaitMinutes == null} hint="Mean elapsed time for active movements" />
      <Stat label="Turnaround avg" value={unavailable ? 'Awaiting data' : stats.avgTurnaroundMinutes == null ? 'No completed exits' : fmt(stats.avgTurnaroundMinutes)} unavailable={unavailable || stats.avgTurnaroundMinutes == null} hint="Completed movements with recorded exit times" />
      <Stat label="Dock load" value={docksError ? 'Feed unavailable' : live&&!docksRead ? 'Awaiting data' : dockUtil == null ? 'No configured docks' : `${dockUtil}%`} unavailable={!!docksError || dockUtil == null} tone={!docksError && dockUtil != null && dockUtil > 85 ? 'alert' : 'plain'} hint="Occupied docks in the current yard snapshot" />
    </div>
    <div className="report-review-grid">
      <section className="report-panel" aria-label="Queue distribution">
        <div className="report-section-heading"><h2>Queue by status</h2><span>{unavailable?'Awaiting data':`${stats.total} loaded`}</span></div>
        {feedError ? <p role="alert" className="report-empty">Queue snapshot unavailable.</p> : awaitingData ? <p role="status" className="report-empty">Loading the assigned yard. Metrics appear after a successful read.</p> : stats.total === 0 ? <div className="report-empty"><h3>No movements yet</h3><p>Register the first arrival to start the baseline.</p></div> : <ul className="report-state-list">{Object.entries(stats.byStatus).map(([status, count]) => <li key={status}>
          <span>{status.replace(/_/g, ' ').toLowerCase()}</span><div className="report-state-track" aria-hidden="true"><i className={status === 'QUARANTINED' ? 'state-blocked' : ['PENDING_OVERRIDE','OVERRIDE_APPROVED'].includes(status) ? 'state-warning' : ['RELEASED','COMPLETED'].includes(status) ? 'state-ready' : 'state-active'} style={{ width: `${100 * count / stats.total}%` }} /></div><strong>{count}</strong>
        </li>)}</ul>}
        <details className="operational-details mt-4"><summary>How to read these figures</summary><p className="mt-2">Counts cover the loaded movements, not the full history. Status counts and readiness do not grant permission to release.</p></details>
      </section>
    <section className="report-panel" aria-label="Data availability">
      <div className="report-section-heading"><h2>Data availability</h2><span>Source coverage</span></div>
      <div className="report-source-list">
        <div><strong>Yard movements</strong><span>{!live ? 'Practice dataset' : feedError ? 'Read failed. Last snapshot may be stale.' : lastRead ? `${stats.total} ${stats.total===1?'movement':'movements'} loaded` : 'Awaiting first read'}</span></div>
        <div><strong>Dock occupancy</strong><span>{!live ? 'No live yard connected' : docksError ? 'Read failed' : !docksRead ? 'Awaiting first read' : docks.length ? `${docks.length} docks loaded` : 'No configured docks'}</span></div>
        <div><strong>Corridor and dwell feeds</strong><span>{!analytics ? 'No analytics connection configured' : 'External analytics configured'}</span></div>
      </div>
      <details className="operational-details mt-3"><summary>Report details and tools</summary><p>Figures reflect the current loaded window. Synthetic modelling is separate from measured operational performance.</p>{canVisit('audit',role)&&<Link className="report-text-link mt-2 mr-4" to="/audit">Inspect audit evidence</Link>}{canVisit('modelling',role)&&<Link className="report-text-link mt-2" to="/modelling">Explore synthetic modelling</Link>}</details>
    </section>
    </div>
    {!analytics?<section className="report-unavailable text-sm" aria-label="Unconfigured analytics"><strong>Data source required</strong><p className="mt-1">Connect corridor and historical dwell feeds to enable these analytics.</p>{canVisit('admin',role)&&<Link className="report-text-link mt-2" to="/admin">Review integration setup</Link>}</section>:<div className="report-feed-grid">
      <section className="report-panel" aria-label="Corridor pressure"><div className="report-section-heading"><h2>Corridor pressure</h2><span>External feed</span></div>
        {!analytics ? <div className="report-empty"><h3>Surge detection unavailable</h3><p>A connected corridor feed is required to assess arrival pressure.</p></div> : !surge ? <EmptyState title="Pressure data unavailable" sub="The configured feed has not returned a usable snapshot." /> : <p className={surge.surging ? 'text-red-800' : 'text-emerald-800'}>{surge.surging ? 'SURGE' : 'Flow normal'} · {surge.queuedNow} queued · {surge.arrivalsLastHour} arrivals last hour.</p>}
      </section>
      <section className="report-panel" aria-label="Dwell heatmap"><div className="report-section-heading"><h2>Dwell by entry hour</h2><span>14 day averages</span></div>
        {!analytics ? <div className="report-empty"><h3>Hourly chart unavailable</h3><p>A connected dwell feed is required to compare historical waiting times.</p></div> : !heatmap ? <EmptyState title="Dwell data unavailable" sub="The configured feed has not returned usable hourly records." /> : heatmap.every(b => b.movements === 0) ? <p className="report-empty">No movements in this window.</p> : <ul className="space-y-2">{heatmap.filter(b => b.movements > 0).map(b => <li key={b.hour} className="flex justify-between gap-3 text-sm"><span>{String(b.hour).padStart(2, '0')}:00 · {b.movements} moves</span><strong>{b.avgDwellMinutes == null ? 'N/A' : `${b.avgDwellMinutes}m avg`}</strong></li>)}</ul>}
      </section>
    </div>}
  </div>
}
