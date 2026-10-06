import { useEffect, useState } from 'react'
import { useLive } from '../lib/liveGate'
import type { LiveRow } from '../lib/live'
import { EmptyState, PageHeader, StatusPill } from '../components/ui'
import { DEMO_AUDIT } from '../lib/demoData'
import { useSession } from '../store/session'

const SEED: LiveRow[] = DEMO_AUDIT as unknown as LiveRow[]

export default function AuditLog() {
  const live = useLive()
  const userId = useSession((s) => s.userId)
  const [logs, setLogs] = useState<LiveRow[]>(() => live ? [] : SEED)
  const [feedError, setFeedError] = useState<string | null>(null)

  useEffect(() => {
    if (!live) return
    let cancelled = false
    let unsub: (() => void) | undefined
    import('../lib/live').then((m) => {
      if (!cancelled) unsub = m.subscribe('auditLogs', setLogs, 100, setFeedError) ?? undefined
    })
    return () => { cancelled = true; unsub?.() }
  }, [live, userId])

  return (
    <div>
      <PageHeader
        title="Audit trail"
        sub="Server audit records for releases, overrides and assignments. Chain verification has documented integrity limits."
        mode={live ? 'live' : 'demo'}
      />
      {feedError && <p role="alert" className="mb-3 rounded bg-amber-50 p-3 text-sm">{feedError}</p>}
      {logs.length === 0 ? (
        <EmptyState title="No entries yet" sub="Gate releases, overrides and assignments land here." />
      ) : (
        <ul className="space-y-2">
          {logs.map((l) => (
            <li key={l.id} className="card flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
              <StatusPill status={String(l.action ?? '')} symbol="●" />
              <span className="font-semibold">{String(l.entityType ?? '')} {String(l.entityId ?? '')}</span>
              {typeof l.actor === 'string' && l.actor ? <span className="text-xs font-semibold text-slate-600">· {l.actor}</span> : null}
              <span className="ml-auto font-mono text-xs text-slate-500">hash {String(l.currentHash ?? 'N/A').slice(0, 12)}…</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
