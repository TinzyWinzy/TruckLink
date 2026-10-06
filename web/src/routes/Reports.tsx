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
  const [feedError, setFeedError] = useState<string | null>(null)
  const [docks, setDocks] = useState<LiveRow[]>([])
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
      u2 = m.subscribe('docks', setDocks, 100) ?? undefined
    })
    return () => {
      cancelled = true
      u1?.()
      u2?.()
    }
  }, [live, userId])

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
  const canModel = canVisit('modelling', role)
  const currentYard = workspace?.facilities.find(f => String(f.id) === workspace.selectedFacility)
  const reviewTitle = feedError ? 'Restore the operational feed' : awaitingData ? 'Waiting for operational evidence' : stats.total === 0 ? 'Build the first operational baseline' : blocked > 0 ? `${blocked} movements need controlled review` : stats.overdueCount > 0 ? `${stats.overdueCount} movements exceed the wait threshold` : 'Review the current shift'

  return <div className="reports-workspace space-y-6">
    <PageHeader title="Shift performance" eyebrow="Operations intelligence"
      sub={live ? 'Review yard pressure, exceptions and the evidence behind the current shift.' : 'Explore the review workflow with clearly labelled training records.'}
      mode={live ? 'live' : 'demo'} actions={<button type="button" onClick={downloadCsv} className="btn-primary px-4 text-sm" disabled={awaitingData || !!feedError}>Export CSV</button>} />
    <div className="report-context" aria-label="Report context">
      <span><strong>{workspace?.organisation?.name ?? 'Practice workspace'}</strong> / {currentYard?.name ?? 'Training yard'}</span>
      <span>{live ? lastRead ? `Last successful read ${lastRead.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Connecting to assigned yard' : 'Synthetic practice records'}</span>
      <span>Current loaded movements</span>
    </div>
    {feedError && <p role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">{feedError}</p>}
    <div className="report-metric-strip">
      <Stat label="Overdue > 60m" value={awaitingData ? 'N/A' : String(stats.overdueCount)} tone={stats.overdueCount > 0 ? 'alert' : 'plain'} hint="Active movements above the waiting threshold" />
      <Stat label="Waiting now" value={awaitingData ? 'N/A' : fmt(stats.avgWaitMinutes)} hint="Mean elapsed time for active movements" />
      <Stat label="Turnaround avg" value={awaitingData ? 'N/A' : fmt(stats.avgTurnaroundMinutes)} hint="Completed movements with recorded exit times" />
      <Stat label="Dock load" value={dockUtil == null ? 'N/A' : `${dockUtil}%`} tone={dockUtil != null && dockUtil > 85 ? 'alert' : 'plain'} hint="Occupied docks in the current yard snapshot" />
    </div>
    <div className="report-review-grid">
      <section className="report-panel" aria-label="Queue distribution">
        <div className="report-section-heading"><h2>Queue by status</h2><span>{stats.total} loaded</span></div>
        {awaitingData ? <p className="report-empty">Loading the assigned yard. Metrics appear after a successful read.</p> : stats.total === 0 ? <div className="report-empty"><h3>No movements yet</h3><p>Register the first arrival to start the baseline.</p></div> : <ul className="report-state-list">{Object.entries(stats.byStatus).map(([status, count]) => <li key={status}>
          <span>{status.replace(/_/g, ' ')}</span><div className="report-state-track" aria-hidden="true"><i style={{ width: `${100 * count / stats.total}%` }} /></div><strong>{count}</strong>
        </li>)}</ul>}
        <p className="report-note">Status counts describe loaded movements. They do not establish regulatory approval or permission to release.</p>
      </section>
      <section className="report-review-panel" aria-label="Review priority">
        <p className="eyebrow">Evidence before release</p><h2>{reviewTitle}</h2>
        <p>{feedError ? 'The last successful snapshot may be stale. Restore the operational connection before using these figures for a decision.' : awaitingData ? 'The assigned yard is loading. Review metrics after a successful read; unavailable values are not treated as zero.' : stats.total === 0 ? 'Operational records build the baseline. Use synthetic modelling to examine evaluation behaviour and capacity assumptions while the yard is empty.' : 'Resolve quarantine and approval evidence through the controlled workflow. Review overdue movements before assigning the next available dock.'}</p>
        <div className="report-actions">
          {canVisit('queue', role) && <Link className="btn-primary px-4" to="/queue">Open shift queue →</Link>}
          {canVisit('audit', role) && <Link className="report-text-link" to="/audit">Inspect audit evidence →</Link>}
          {canModel && <Link className="report-text-link" to="/modelling">Explore synthetic modelling →</Link>}
        </div>
        <p className="report-note">Every action remains scoped to your tenant, yard and working role.</p>
      </section>
    </div>
    <section className="report-panel" aria-label="Data availability">
      <div className="report-section-heading"><h2>Data availability</h2><span>Source coverage</span></div>
      <div className="report-source-grid">
        <div><strong>Yard movements</strong><span>{!live ? 'Practice dataset' : feedError ? 'Read failed. Last snapshot may be stale.' : lastRead ? `${stats.total} movements loaded` : 'Awaiting first read'}</span></div>
        <div><strong>Dock occupancy</strong><span>{!live ? 'No live yard connected' : docks.length ? `${docks.length} docks loaded` : 'No dock snapshot available'}</span></div>
        <div><strong>Corridor and dwell feeds</strong><span>{!analytics ? 'No analytics connection configured' : 'External analytics configured'}</span></div>
      </div>
    </section>
    <div className="report-feed-grid">
      <section className="report-panel" aria-label="Corridor pressure"><div className="report-section-heading"><h2>Corridor pressure</h2><span>External feed</span></div>
        {!analytics ? <div className="report-empty"><h3>Surge detection unavailable</h3><p>A connected corridor feed is required to assess arrival pressure.</p></div> : !surge ? <EmptyState title="Pressure data unavailable" sub="The configured feed has not returned a usable snapshot." /> : <p className={surge.surging ? 'text-red-800' : 'text-emerald-800'}>{surge.surging ? 'SURGE' : 'Flow normal'} · {surge.queuedNow} queued · {surge.arrivalsLastHour} arrivals last hour.</p>}
      </section>
      <section className="report-panel" aria-label="Dwell heatmap"><div className="report-section-heading"><h2>Dwell by entry hour</h2><span>14 day averages</span></div>
        {!analytics ? <div className="report-empty"><h3>Hourly chart unavailable</h3><p>A connected dwell feed is required to compare historical waiting times.</p></div> : !heatmap ? <EmptyState title="Dwell data unavailable" sub="The configured feed has not returned usable hourly records." /> : heatmap.every(b => b.movements === 0) ? <p className="report-empty">No movements in this window.</p> : <ul className="space-y-2">{heatmap.filter(b => b.movements > 0).map(b => <li key={b.hour} className="flex justify-between gap-3 text-sm"><span>{String(b.hour).padStart(2, '0')}:00 · {b.movements} moves</span><strong>{b.avgDwellMinutes == null ? 'N/A' : `${b.avgDwellMinutes}m avg`}</strong></li>)}</ul>}
      </section>
    </div>
  </div>
}
