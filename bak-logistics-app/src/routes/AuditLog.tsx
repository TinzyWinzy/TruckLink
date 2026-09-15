import { useEffect, useState } from 'react'
import { isLive } from '../lib/firebase'
import type { LiveRow } from '../lib/live'
import { EmptyState, PageHeader, StatusPill } from '../components/ui'

const SEED: LiveRow[] = [
  { id: 'seed-1', action: 'GATE_RELEASE', entityType: 'queueEntry', entityId: 'q-seed-9', currentHash: '9f2c…a41d', timestamp: '09:02' },
  { id: 'seed-2', action: 'OVERRIDE_APPROVE', entityType: 'complianceCheck', entityId: 'c-seed-4', currentHash: '71be…03c9', timestamp: '08:47' },
]

export default function AuditLog() {
  const [logs, setLogs] = useState<LiveRow[]>(SEED)
  const live = isLive()

  useEffect(() => {
    if (!live) return
    let unsub: (() => void) | undefined
    import('../lib/live').then((m) => {
      unsub = m.subscribe('auditLogs', setLogs) ?? undefined
    })
    return () => unsub?.()
  }, [live])

  return (
    <div>
      <PageHeader
        title="Audit trail"
        sub="Append-only, hash-chained, 7-year retention. Chaining is server-side; the client reads the verified chain."
        mode={live ? 'live' : 'demo'}
      />
      {logs.length === 0 ? (
        <EmptyState title="No entries yet" sub="Gate releases, overrides and assignments land here." />
      ) : (
        <ul className="space-y-2">
          {logs.map((l) => (
            <li key={l.id} className="card flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
              <StatusPill status={String(l.action ?? '')} symbol="●" />
              <span className="font-semibold">{String(l.entityType ?? '')} {String(l.entityId ?? '')}</span>
              <span className="ml-auto font-mono text-xs text-slate-500">hash {String(l.currentHash ?? '—').slice(0, 12)}…</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
