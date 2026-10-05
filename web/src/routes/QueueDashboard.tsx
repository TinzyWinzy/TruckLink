import { useEffect, useMemo, useState } from 'react'
import { queueEntrySchema } from '../lib/validation/compliance'
import { enqueueOfflineAction, isOnline } from '../lib/offline/db'
import { useLive } from '../lib/liveGate'
import type { LiveRow } from '../lib/live'
import { useSession } from '../store/session'
import { Link } from 'react-router-dom'
import { DEMO_QUEUE } from '../lib/demoData'
import { EmptyState, PageHeader, StatusPill, spineForStatus } from '../components/ui'

interface Row {
  id: string
  plate: string
  driver: string
  cargo: string
  dest: string
  rawStatus: string
  enteredAt: string
}

const SYMBOL: Record<string, string> = {
  QUEUED: '◆',
  ASSIGNED: '►',
  LOADING: '●',
  COMPLETED: '✔',
  QUARANTINED: '✖',
  RELEASED: '✔✔',
  PENDING_OVERRIDE: '…',
  OVERRIDE_APPROVED: '✔*',
}

function mapLive(r: LiveRow): Row {
  const rawStatus = String(r.status ?? 'QUEUED')
  const ts = r.entryTimestamp as { toDate?: () => Date } | string | undefined
  let enteredAt = '—'
  if (typeof ts === 'string' && ts) {
    const parsed = new Date(ts)
    enteredAt = Number.isNaN(parsed.getTime())
      ? ts
      : parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (ts && typeof ts === 'object' && typeof ts.toDate === 'function') {
    enteredAt = ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return {
    id: r.id,
    plate: String(r.licensePlate ?? '—'),
    driver: String(r.driverName ?? (r.driverId as string) ?? '—'),
    cargo: String(r.cargoType ?? '—'),
    dest: String(r.expectedDestination ?? '—'),
    rawStatus,
    enteredAt,
  }
}

const SEED: Row[] = DEMO_QUEUE

/** Short readable tail of an entry ID for the board — full ID copies on tap. */
function shortId(id: string): string {
  return id.length > 10 ? `…${id.slice(-8)}` : id
}

export default function QueueDashboard() {
  const { role, displayName, userId } = useSession()
  const live = useLive()
  const [rows, setRows] = useState<Row[]>(() => live ? [] : SEED)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [plate, setPlate] = useState('')
  const [driver, setDriver] = useState('')
  const [cargo, setCargo] = useState('Container')
  const [dest, setDest] = useState('Beitbridge')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState('ALL')

  useEffect(() => {
    if (!live) return
    let cancelled = false
    let unsub: (() => void) | undefined
    import('../lib/live').then((m) => {
      if (!cancelled) unsub = m.subscribe('queue', (found) => setRows(found.map(mapLive)), 100, setFeedError) ?? undefined
    })
    return () => { cancelled = true; unsub?.() }
  }, [live, userId])

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length }
    for (const r of rows) c[r.rawStatus] = (c[r.rawStatus] ?? 0) + 1
    return c
  }, [rows])
  const shown = filter === 'ALL' ? rows : rows.filter((r) => r.rawStatus === filter)
  const canRelease = role === 'DISPATCH_SUPERVISOR' || role === 'OPERATIONS_SUPERVISOR' || role === 'FACILITY_MANAGER'

  async function register() {
    const parsed = queueEntrySchema.safeParse({
      licensePlate: plate,
      driverName: driver,
      cargoType: cargo,
      expectedDestination: dest,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid entry')
      return
    }
    setError(null)
    setNotice(null)

    if (!live) {
      setRows((r) => [
        {
          id: `q-${Date.now()}`,
          plate: parsed.data.licensePlate.toUpperCase(),
          driver: parsed.data.driverName,
          cargo: parsed.data.cargoType,
          dest: parsed.data.expectedDestination,
          rawStatus: 'QUEUED',
          enteredAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
        ...r,
      ])
      setPlate('')
      setDriver('')
      setNotice('✔ Entry added — practice entry, training only.')
      return
    }

    if (!isOnline()) {
      await enqueueOfflineAction('queue.create', { ...parsed.data })
      setNotice('⏳ Offline — entry queued, will sync on reconnect.')
      setPlate('')
      setDriver('')
      return
    }
    try {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      await (await import('../lib/live')).registerVehicleLive(parsed.data, key)
      setPlate('')
      setDriver('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function copyId(id: string) {
    const done = async () => setNotice(`✔ ID ${shortId(id)} copied — paste it in the check screen.`)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(id)
        await done()
        return
      }
      throw new Error('no clipboard API')
    } catch {
      // Older yard WebViews: select-and-copy fallback.
      try {
        const ta = document.createElement('textarea')
        ta.value = id
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        await done()
      } catch {
        setError(`Entry ID is ${id} — type it into the check screen.`)
      }
    }
  }

  async function release(id: string) {
    setError(null)
    try {
      await (await import('../lib/live')).releaseVehicleLive(id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Shift queue"
        eyebrow="Yard operations · oldest first"
        sub={live ? 'Live yard board — oldest first. Register at the gate, release at the exit.' : 'Practice board — training entries only.'}
        mode={live ? 'live' : 'demo'}
      />
      {feedError && <p role="alert" className="mb-3 rounded bg-amber-50 p-3 text-sm">{feedError}</p>}
      {/* Primary job first: register the truck in front of you (Fitts + Hick) */}
      <section className="card p-4 sm:p-5" aria-label="Register vehicle">
        <h2 className="text-base font-extrabold">Register arrival</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          <input aria-label="License plate" placeholder="Plate · AEH 4521" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className="field touch-target px-3 md:col-span-1" autoCapitalize="characters" />
          <input aria-label="Driver name" placeholder="Driver" value={driver} onChange={(e) => setDriver(e.target.value)} className="field touch-target px-3 md:col-span-1" />
          <input aria-label="Cargo type" value={cargo} onChange={(e) => setCargo(e.target.value)} className="field touch-target px-3 md:col-span-1" />
          <input aria-label="Destination" value={dest} onChange={(e) => setDest(e.target.value)} className="field touch-target px-3 md:col-span-1" />
          <button type="button" onClick={register} className="btn-primary touch-target px-4 text-base md:col-span-1">
            + Register
          </button>
        </div>
        {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-sm font-bold text-red-800">✖ {error}</p>}
        {notice && <p role="status" className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm font-bold text-emerald-800">{notice}</p>}
      </section>

      {/* Filter by exception first (Pareto) */}
      <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter queue">
        {['ALL', 'QUARANTINED', 'QUEUED', 'ASSIGNED', 'RELEASED'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            aria-pressed={filter === s}
            className={`touch-target rounded-full px-3 text-sm font-bold ${filter === s ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}
          >
            {s} · {counts[s] ?? 0}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="mt-3"><EmptyState title="Yard is clear" sub="No vehicles in this state. New arrivals appear here first." /></div>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map((r) => (
            <li key={r.id} className={`card spine ${spineForStatus(r.rawStatus)} flex flex-wrap items-center gap-x-3 gap-y-1 py-3 pl-5 pr-4`}>
              <strong className="tnum text-lg tracking-tight">{r.plate}</strong>
              <StatusPill status={r.rawStatus} symbol={SYMBOL[r.rawStatus]} />
              <span className="w-full text-sm text-slate-600 sm:w-auto">{r.driver} · {r.cargo} → {r.dest} · in {r.enteredAt}</span>
              <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:ml-auto">
                <button
                  type="button"
                  onClick={() => void copyId(r.id)}
                  aria-label={`Copy entry ID for ${r.plate}`}
                  title="Copy full entry ID"
                  className="touch-target rounded-lg border border-slate-300 bg-white px-2 font-data text-xs font-bold text-slate-600 hover:border-slate-500"
                >
                  ID {shortId(r.id)} ⧉
                </button>
                <Link
                  to={`/compliance?entry=${encodeURIComponent(r.id)}`}
                  aria-label={`Check ${r.plate}`}
                  className="touch-target rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white"
                >
                  Check →
                </Link>
              </span>
              {(r.rawStatus === 'COMPLETED' || r.rawStatus === 'OVERRIDE_APPROVED') && live && canRelease && (
                <button type="button" onClick={() => void release(r.id)} className="btn-accent touch-target rounded-lg px-4 text-sm" aria-label={`Release ${r.plate}`}>
                  Release {r.plate} →
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">Signed in as {displayName}. Every status shows a shape + words — nothing depends on colour alone.</p>
    </div>
  )
}
