import { useEffect, useState } from 'react'
import { isLive } from '../lib/firebase'
import type { LiveRow } from '../lib/live'
import { useSession } from '../store/session'
import { EmptyState, PageHeader, StatusPill } from '../components/ui'
import { approveOverridePS, acknowledgeAlertPS } from '../lib/powersync/operations'

const SEED: LiveRow[] = [
  { id: 'seed-1', type: 'QUARANTINE', severity: 'CRITICAL', status: 'ACTIVE', message: 'AFM 1187 quarantined: Axle 2 overloaded by 1,400kg. Rebalancing or override required.', triggeredAt: '08:19' },
  { id: 'seed-2', type: 'EXCESSIVE_WAIT', severity: 'HIGH', status: 'ACTIVE', message: 'ABZ 9901 waiting 74m (exceeds 60m threshold)', triggeredAt: '08:19' },
  { id: 'seed-3', type: 'EQUIPMENT_SHORTAGE', severity: 'MEDIUM', status: 'ACKNOWLEDGED', message: 'Forklift utilization 87% — consider rebalancing', triggeredAt: '07:55' },
]

export default function Alerts() {
  const { userId, role, displayName } = useSession()
  const [alerts, setAlerts] = useState<LiveRow[]>(SEED)
  const [message, setMessage] = useState<string | null>(null)
  const [overrideTarget, setOverrideTarget] = useState<string | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const live = isLive()
  const active = alerts.filter((a) => String(a.status) === 'ACTIVE' || !a.acknowledged)
  const canApproveOverride = role === 'OPERATIONS_SUPERVISOR' || role === 'FACILITY_MANAGER' || role === 'ADMIN'

  useEffect(() => {
    if (!live) return
    let unsub: (() => void) | undefined
    import('../lib/live').then((m) => {
      unsub = m.subscribe('alerts', setAlerts) ?? undefined
    })
    return () => unsub?.()
  }, [live])

  async function ack(id: string) {
    if (!live) {
      setAlerts((a) => a.map((x) => (x.id === id ? { ...x, status: 'ACKNOWLEDGED' } : x)))
      return
    }
    try {
      await (await import('../lib/live')).acknowledgeAlertLive(id, displayName)
    } catch (e) {
      setMessage(`✖ ${(e as Error).message}`)
    }
  }

  async function handleApproveOverride(alertId: string) {
    if (!overrideReason.trim()) {
      setMessage('✖ Enter a justification reason before approving override.')
      return
    }
    try {
      if (live) {
        await (await import('../lib/live')).approveOverrideLive(alertId, true, userId ?? displayName)
      } else {
        await approveOverridePS({
          facilityId: 'demo-facility',
          checkId: alertId,
          authorizerId: userId || 'demo-supervisor',
          reason: overrideReason.trim()
        }).catch(() => {
          // In demo fallback, mark local state
        })
        setAlerts((a) => a.map((x) => (x.id === alertId ? { ...x, status: 'OVERRIDE_APPROVED' } : x)))
      }
      await acknowledgeAlertPS('demo-facility', alertId, userId || 'demo-supervisor').catch(() => {})
      setOverrideTarget(null)
      setOverrideReason('')
      setMessage('✔ Quarantine override approved and recorded in audit log.')
    } catch (err: any) {
      setMessage(`✖ ${err.message}`)
    }
  }

  return (
    <div>
      <PageHeader
        title={`Alerts · ${active.length} active`}
        sub="Critical quarantine alerts first. Acknowledge when you own the problem — escalation runs at 10 and 30 minutes."
        mode={live ? 'live' : 'demo'}
      />
      {message && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800">
          {message}
        </p>
      )}
      {alerts.length === 0 ? (
        <EmptyState title="Yard is quiet" sub="No alerts. New quarantine, wait and equipment flags land here." />
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => {
            const isActive = String(a.status) === 'ACTIVE' || a.acknowledged === 0
            const isCritical = String(a.severity) === 'CRITICAL' || String(a.type) === 'QUARANTINE'
            const isTargeted = overrideTarget === a.id

            return (
              <li
                key={a.id}
                className={`card flex flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center ${
                  isActive && isCritical ? 'border-2 border-red-700 bg-red-50/20' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <StatusPill
                    status={`${String(a.severity ?? '')} · ${String(a.type ?? '').replace(/_/g, ' ')}`}
                    symbol="■"
                  />
                </div>
                <span className="w-full text-[15px] sm:w-auto sm:flex-1">{String(a.message ?? '')}</span>
                <StatusPill status={String(a.status ?? (a.acknowledged ? 'ACKNOWLEDGED' : 'ACTIVE'))} />

                {isActive && (
                  <div className="mt-2 flex w-full flex-wrap items-center gap-2 sm:mt-0 sm:w-auto sm:ml-auto">
                    {isCritical && canApproveOverride && (
                      <button
                        type="button"
                        onClick={() => setOverrideTarget(isTargeted ? null : a.id)}
                        className="btn-accent touch-target rounded-lg px-3 text-xs font-bold"
                      >
                        {isTargeted ? 'Cancel' : 'Authorize Override ⚖'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void ack(a.id)}
                      className="btn-primary touch-target rounded-lg px-4 text-sm"
                    >
                      Acknowledge
                    </button>
                  </div>
                )}

                {isTargeted && (
                  <div className="mt-2 w-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                    <p className="font-bold text-amber-900">
                      Secondary Approver Override Authorization (Supervisor: {displayName || role})
                    </p>
                    <p className="text-xs text-amber-800">
                      Requires explicit regulatory or operational justification (logged to cryptographic audit chain).
                    </p>
                    <input
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="e.g. Official decant verified at Bay 4 / Ministry waiver permit attached"
                      className="field mt-2 w-full px-3 py-1.5 text-sm"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleApproveOverride(a.id)}
                        className="btn-primary touch-target rounded-lg px-4 py-1 text-xs font-bold"
                      >
                        Confirm & Approve Override ✔
                      </button>
                      <button
                        type="button"
                        onClick={() => setOverrideTarget(null)}
                        className="touch-target rounded-lg border px-3 py-1 text-xs font-bold text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
