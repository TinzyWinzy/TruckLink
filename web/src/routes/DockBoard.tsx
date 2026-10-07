import { useEffect, useState } from 'react'
import { useLive } from '../lib/liveGate'
import type { LiveRow } from '../lib/live'
import { isOnline } from '../lib/offline/db'
import { EmptyState, PageHeader, StatusPill, spineForStatus } from '../components/ui'
import { DEMO_DOCKS } from '../lib/demoData'
import { useSession } from '../store/session'

interface Dock {
  id: string
  label: string
  rawStatus: string
  occupant: string
  util: number | null
}

const SEED: Dock[] = DEMO_DOCKS

const SYMBOL: Record<string, string> = { AVAILABLE: '○', OCCUPIED: '■', MAINTENANCE: '✚', RESERVED: '◐' }

function mapLive(r: LiveRow): Dock {
  const s = String(r.status ?? 'AVAILABLE')
  return {
    id: r.id,
    label: String(r.name ?? r.id),
    rawStatus: s,
    occupant: r.currentAssignment ? String(r.currentAssignment) : '',
    util: null,
  }
}

export default function DockBoard() {
  const live = useLive()
  const userId = useSession((s) => s.userId)
  const workspace = useSession((s) => s.workspace)
  const siteName = workspace?.facilities.find(f => String(f.id) === workspace.selectedFacility)?.name
  const [docks, setDocks] = useState<Dock[]>(() => live ? [] : SEED)
  const [loaded, setLoaded] = useState(!live)
  const [retry, setRetry] = useState(0)
  function retryFeed() { setFeedError(null); setLoaded(false); setRetry(n => n + 1) }
  const [feedError, setFeedError] = useState<string | null>(null)
  const [queuedIds, setQueuedIds] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const free = docks.filter((d) => d.rawStatus === 'AVAILABLE').length

  useEffect(() => {
    if (!live) return
    let cancelled = false
    let u1: (() => void) | undefined
    let u2: (() => void) | undefined
    import('../lib/live').then((m) => {
      if (cancelled) return
      u1 = m.subscribe('docks', (found) => { setDocks(found.map(mapLive)); setLoaded(true) }, 100, setFeedError) ?? undefined
      u2 = m.subscribe('queue', (found) => setQueuedIds(found.filter((r) => r.status === 'QUEUED').map((r) => r.id))) ?? undefined
    })
    return () => {
      cancelled = true
      u1?.()
      u2?.()
    }
  }, [live, userId, retry])

  async function tap(dock: Dock) {
    setMessage(null)
    if (!live) {
      setMessage(`Practice. ${dock.label} tap recorded on this tablet.`)
      return
    }
    if (!isOnline()) {
      setMessage('■ Offline. Dock moves need signal. Trucks keep queueing.')
      return
    }
    const first = queuedIds[0]
    if (!first) {
      setMessage('Queue is empty. Register an arrival first.')
      return
    }
    try {
      await (await import('../lib/live')).assignDockLive(first, dock.id)
      setMessage(`✔ ${first} → ${dock.label}.`)
    } catch (e) {
      setMessage(`✖ ${(e as Error).message}`)
    }
  }

  return (
    <div>
      <PageHeader
        title="Dock board"
        eyebrow={live ? siteName || 'Selected site' : 'Practice site'}
        sub={live ? loaded ? `${free} of ${docks.length} docks free. Tap a free dock to take the oldest queued truck.` : 'Loading the selected site’s dock configuration.' : 'Practice layout. Training docks only.'}
        mode={live ? 'live' : 'demo'}
      />
      {feedError && <p role="alert" className="mb-3 rounded bg-amber-50 p-3 text-sm">{feedError} <button className="underline" onClick={retryFeed}>Retry</button></p>}
      {message && <p role="status" className="mb-3 rounded-lg bg-slate-900 p-3 text-sm font-bold text-white">{message}</p>}
      {!loaded && !feedError ? <p role="status">Loading docks…</p> : feedError && docks.length === 0 ? null : docks.length === 0 ? (
        <EmptyState title="No docks configured" sub="Ask your supervisor to set up the yard." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {docks.map((d) => {
            const free_ = d.rawStatus === 'AVAILABLE'
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => void tap(d)}
                disabled={live && !free_}
                className={`card spine touch-target p-4 pl-5 text-left ${spineForStatus(d.rawStatus)} ${free_ ? 'ring-2 ring-emerald-600 hover:shadow-md' : ''} disabled:opacity-70`}
                aria-label={`${d.label}, ${d.rawStatus}${d.occupant ? `, ${d.occupant}` : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-lg font-extrabold">{d.label}</span>
                  <StatusPill status={d.rawStatus} symbol={SYMBOL[d.rawStatus]} />
                </div>
                <p className="mt-1 min-h-5 text-sm font-semibold text-slate-600">{d.occupant || (free_ ? 'Tap to assign oldest truck' : 'N/A')}</p>
                {d.util != null ? <div className="mt-2 h-2.5 rounded bg-slate-200" role="img" aria-label={`${d.label} demo utilization ${d.util} percent`}>
                  <div className="h-2.5 rounded bg-slate-900" style={{ width: `${d.util}%` }} />
                </div> : <p className="mt-2 text-xs text-slate-500">Utilization history unavailable</p>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
