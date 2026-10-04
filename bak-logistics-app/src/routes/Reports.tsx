import { useEffect, useMemo, useState } from 'react'
import { facilityId } from '../lib/firebase'
import { useLive } from '../lib/liveGate'
import { computeTurnaroundStats, queueToCsv, type LiveRow } from '../lib/live'
import {
  fetchHeatmap,
  fetchRoi,
  fetchSurge,
  isAnalyticsLive,
  type HeatmapBucket,
  type RoiSummary,
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

const fmt = (n: number | null) => (n == null ? '—' : `${Math.round(n)}m`)

export default function Reports() {
  const [rows, setRows] = useState<LiveRow[]>(SEED)
  const [docks, setDocks] = useState<LiveRow[]>([])
  const [heatmap, setHeatmap] = useState<HeatmapBucket[] | null>(null)
  const [surge, setSurge] = useState<SurgeStatus | null>(null)
  const [roi, setRoi] = useState<RoiSummary | null>(null)
  const live = useLive()
  const analytics = isAnalyticsLive()

  useEffect(() => {
    if (!live) return
    let u1: (() => void) | undefined
    let u2: (() => void) | undefined
    import('../lib/live').then((m) => {
      u1 = m.subscribe('queue', setRows, 500) ?? undefined
      u2 = m.subscribe('docks', setDocks, 100) ?? undefined
    })
    return () => {
      u1?.()
      u2?.()
    }
  }, [live])

  useEffect(() => {
    if (!analytics) return
    let cancelled = false
    Promise.all([fetchHeatmap(facilityId), fetchSurge(facilityId), fetchRoi(facilityId)]).then(
      ([h, s, r]) => {
        if (cancelled) return
        if (h) setHeatmap(h.buckets)
        if (s) setSurge(s)
        if (r) setRoi(r)
      },
    ).catch(() => {
      // Offline or server unreachable — sections below stay in empty states.
    })
    return () => {
      cancelled = true
    }
  }, [analytics])

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

  return (
    <div>
      <PageHeader
        title="Shift performance"
        sub={live ? 'Live numbers for the SLA conversation — waiting now, cleared today, dock pressure.' : 'Practice numbers — training data only.'}
        mode={live ? 'live' : 'demo'}
        actions={
          <button type="button" onClick={downloadCsv} className="btn-primary touch-target rounded-lg px-4 text-sm">
            ↓ Export CSV
          </button>
        }
      />
      {/* Exceptions first: overdue and dock pressure lead (Pareto) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Overdue > 60m" value={String(stats.overdueCount)} tone={stats.overdueCount > 0 ? 'alert' : 'good'} />
        <Stat label="Waiting now" value={fmt(stats.avgWaitMinutes)} tone="plain" />
        <Stat label="Turnaround avg" value={fmt(stats.avgTurnaroundMinutes)} tone="plain" />
        <Stat label="Dock load" value={dockUtil == null ? '—' : `${dockUtil}%`} tone={dockUtil != null && dockUtil > 85 ? 'alert' : 'plain'} />
      </div>
      <h2 className="mb-2 mt-6 text-base font-extrabold">Queue by status · {stats.total} total</h2>
      {stats.total === 0 ? (
        <EmptyState title="No movements yet" sub="Register the first arrival to start the baseline." />
      ) : (
        <ul className="space-y-1">
          {Object.entries(stats.byStatus).map(([s, n]) => (
            <li key={s} className="card flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="font-semibold">{s}</span>
              <strong className="text-lg tabular-nums">{n}</strong>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 mt-6 text-base font-extrabold">Corridor pressure</h2>
      {!analytics ? (
        <EmptyState title="Surge detection unavailable" sub="Ask your supervisor to connect the corridor feed." />
      ) : !surge ? (
        <EmptyState title="Loading pressure…" sub="Reaching the sync API." />
      ) : surge.surging ? (
        <div role="alert" className="card border-red-700 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">
          ▲ SURGE — {surge.queuedNow} queued (≥ {surge.threshold}) · {surge.arrivalsLastHour} arrivals last hour.
          Hold releases and open the overflow bay.
        </div>
      ) : (
        <div className="card px-4 py-3 text-sm font-semibold text-emerald-900">
          ● Flow normal — {surge.queuedNow} queued · {surge.arrivalsLastHour} arrivals last hour.
        </div>
      )}

      <h2 className="mb-2 mt-6 text-base font-extrabold">ZINARA fines intercepted · 30d</h2>
      {!analytics ? (
        <EmptyState title="Fines tracker unavailable" sub="Ask your supervisor to connect the fines feed." />
      ) : !roi ? (
        <EmptyState title="Loading ROI…" sub="Reaching the sync API." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Fines intercepted" value={`$${roi.finesInterceptedUsd.toLocaleString()}`} tone="good" />
          <Stat label="Checks intercepted" value={String(roi.checksIntercepted)} tone="plain" />
          <Stat label="Overload stopped" value={`${roi.overloadKgTotal.toLocaleString()}kg`} tone="plain" />
          <Stat
            label="Payback vs $6.2k pilot"
            value={roi.paybackMultiple == null ? '—' : `${roi.paybackMultiple}×`}
            tone={roi.paybackMultiple != null && roi.paybackMultiple >= 1 ? 'good' : 'plain'}
          />
        </div>
      )}

      <h2 className="mb-2 mt-6 text-base font-extrabold">Dwell heatmap · 14d avg by entry hour</h2>
      {!analytics ? (
        <EmptyState title="Hourly chart unavailable" sub="Ask your supervisor to connect the dwell feed." />
      ) : !heatmap ? (
        <EmptyState title="Loading heatmap…" sub="Reaching the sync API." />
      ) : heatmap.every((b) => b.movements === 0) ? (
        <EmptyState title="No movements in window" sub="Register arrivals to build the heatmap." />
      ) : (
        <ul className="space-y-1">
          {heatmap.filter((b) => b.movements > 0).map((b) => (
            <li key={b.hour} className="card flex items-center justify-between px-4 py-2 text-sm">
              <span className="font-semibold tabular-nums">{String(b.hour).padStart(2, '0')}:00</span>
              <span className="text-slate-600">{b.movements} moves</span>
              <strong className="tabular-nums">{b.avgDwellMinutes == null ? '—' : `${b.avgDwellMinutes}m avg`}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
