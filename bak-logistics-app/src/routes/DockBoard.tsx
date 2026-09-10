import { useEffect, useState } from 'react'
import { isLive } from '../lib/firebase'
import type { LiveRow } from '../lib/live'
import { isOnline } from '../lib/offline/db'
import { EmptyState, PageHeader, StatusPill } from '../components/ui'

interface Dock {
  id: string
  label: string
  rawStatus: string
  occupant: string
  util: number
}

const SEED: Dock[] = [
  { id: 'D1', label: 'Dock 1', rawStatus: 'OCCUPIED', occupant: 'AEH 4521', util: 82 },
  { id: 'D2', label: 'Dock 2', rawStatus: 'AVAILABLE', occupant: '', util: 41 },
  { id: 'D3', label: 'Dock 3', rawStatus: 'AVAILABLE', occupant: '', util: 35 },
  { id: 'D4', label: 'Dock 4', rawStatus: 'MAINTENANCE', occupant: '', util: 0 },
]

const SYMBOL: Record<string, string> = { AVAILABLE: '○', OCCUPIED: '■', MAINTENANCE: '✚', RESERVED: '◐' }

function mapLive(r: LiveRow): Dock {
  const s = String(r.status ?? 'AVAILABLE')
  return {
    id: r.id,
    label: String(r.name ?? r.id),
    rawStatus: s,
    occupant: r.currentAssignment ? String(r.currentAssignment) : '',
    util: s === 'OCCUPIED' ? 82 : s === 'AVAILABLE' ? 40 : 0,
  }
}

export default function DockBoard() {
  const [docks, setDocks] = useState<Dock[]>(SEED)
  const [queuedIds, setQueuedIds] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const live = isLive()
  const free = docks.filter((d) => d.rawStatus === 'AVAILABLE').length

  useEffect(() => {
    if (!live) return
    let u1: (() => void) | undefined
    let u2: (() => void) | undefined
    import('../lib/live').then((m) => {
      u1 = m.subscribe('docks', (found) => setDocks(found.map(mapLive))) ?? undefined
      u2 = m.subscribe('queue', (found) => setQueuedIds(found.filter((r) => r.status === 'QUEUED').map((r) => r.id))) ?? undefined
    })
    return () => {
      u1?.()
      u2?.()
    }
  }, [live])

  async function tap(dock: Dock) {
    setMessage(null)
    if (!live) {
      setMessage(`Demo — ${dock.label} tap recorded locally.`)
      return
    }
    if (!isOnline()) {
      setMessage('■ Offline — dock moves need connectivity (transactional). Trucks keep queueing.')
      return
    }
    const first = queuedIds[0]
    if (!first) {
      setMessage('Queue is empty — register an arrival first.')
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
        sub={live ? `${free} of ${docks.length} docks free · ${queuedIds.length} waiting. Tap a free dock to take the oldest truck.` : 'Demo layout — live board shows free docks and waiting trucks.'}
        mode={live ? 'live' : 'demo'}
      />
      {message && <p role="status" className="mb-3 rounded-lg bg-slate-900 p-3 text-sm font-bold text-white">{message}</p>}
      {docks.length === 0 ? (
        <EmptyState title="No docks configured" sub="Ask an ADMIN to seed the facility." />
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
                className={`card touch-target p-4 text-left ${free_ ? 'ring-2 ring-emerald-600 hover:shadow-md' : ''} disabled:opacity-70`}
                aria-label={`${d.label}, ${d.rawStatus}${d.occupant ? `, ${d.occupant}` : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-lg font-extrabold">{d.label}</span>
                  <StatusPill status={d.rawStatus} symbol={SYMBOL[d.rawStatus]} />
                </div>
                <p className="mt-1 min-h-5 text-sm font-semibold text-slate-600">{d.occupant || (free_ ? 'Tap to assign oldest truck' : '—')}</p>
                <div className="mt-2 h-2.5 rounded bg-slate-200" role="img" aria-label={`${d.label} utilization ${d.util} percent`}>
                  <div className="h-2.5 rounded bg-slate-900" style={{ width: `${d.util}%` }} />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
