import { useEffect, useState } from 'react'
import { useLive } from '../lib/liveGate'
import type { LiveRow } from '../lib/live'
import { EmptyState, PageHeader, StatusPill } from '../components/ui'
import { DEMO_AUDIT } from '../lib/demoData'

const SEED: LiveRow[] = DEMO_AUDIT as unknown as LiveRow[]

export default function AuditLog() {
  const [logs, setLogs] = useState<LiveRow[]>(SEED)
  const live = useLive()

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
        sub="Tamper-proof record — every release, override and assignment lands here."
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
              {typeof l.actor === 'string' && l.actor ? <span className="text-xs font-semibold text-slate-600">· {l.actor}</span> : null}
              <span className="ml-auto font-mono text-xs text-slate-500">hash {String(l.currentHash ?? '—').slice(0, 12)}…</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
