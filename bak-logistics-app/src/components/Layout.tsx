import { Link, useLocation } from 'react-router-dom'
import { pendingActionCount, pendingActionCountSyncInitial, isOnline } from '../lib/offline/db'
import { useSession, isPracticeSession, type Role, canAccess } from '../store/session'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { useLive } from '../lib/liveGate'
import { ROUTE_GATES, landingPathForRole } from '../lib/gates'

const PRIMARY: { to: string; label: string; route: keyof typeof ROUTE_GATES }[] = [
  { to: '/queue', label: 'Queue', route: 'queue' },
  { to: '/compliance', label: 'Compliance', route: 'compliance' },
  { to: '/docks', label: 'Docks', route: 'docks' },
]

const SECONDARY: { to: string; label: string; route: keyof typeof ROUTE_GATES }[] = [
  { to: '/hub', label: 'Hub', route: 'hub' },
  { to: '/guide', label: 'Guide', route: 'guide' },
  { to: '/alerts', label: 'Alerts', route: 'alerts' },
  { to: '/reports', label: 'Reports', route: 'reports' },
  { to: '/audit', label: 'Audit', route: 'audit' },
  { to: '/admin', label: 'Admin', route: 'admin' },
]

function visible(items: typeof PRIMARY, role: Role | null) {
  return items.filter((i) => canAccess(role, ROUTE_GATES[i.route]))
}

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { role, userId, displayName, online, setOnline, signOut, signInDemo } = useSession()
  const practice = isPracticeSession(userId)
  const [pending, setPending] = useState(pendingActionCountSyncInitial)
  const [critical, setCritical] = useState(0)
  const live = useLive()

  useEffect(() => {
    const sync = async () => {
      const onlineNow = isOnline()
      if (onlineNow) {
        try {
          await (await import('../lib/live')).flushPendingActions()
        } catch {
          // Replay failures stay queued with retry counts; header shows the backlog.
        }
      }
      setOnline(onlineNow)
      try {
        setPending(await pendingActionCount())
      } catch {
        // IndexedDB blocked — keep last badge value.
      }
    }
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    const id = window.setInterval(sync, 5000)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
      window.clearInterval(id)
    }
  }, [setOnline, pathname])

  useEffect(() => {
    if (!live || !role) return
    let unsub: (() => void) | undefined
    import('../lib/live').then((m) => {
      unsub = m.subscribe('alerts', (rows) =>
        setCritical(rows.filter((r) => String(r.status) === 'ACTIVE' && String(r.severity) === 'CRITICAL').length),
      ) ?? undefined
    })
    return () => unsub?.()
  }, [live, role])

  const linkCls = (to: string) => {
    const active = pathname === to
    const base = 'nav-pill touch-target inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold'
    if (active) return `${base} nav-active`
    return `${base} text-white/75 hover:bg-white/10 hover:text-white`
  }

  return (
    <div className="on-dark min-h-screen text-slate-900">
      <header className="gantry sticky top-0 z-10 text-white shadow-lg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3">
          <Link to={role ? landingPathForRole(role) : '/queue'} className="flex items-center gap-2.5" aria-label="Trucki home">
            <span aria-hidden="true" className="gantry-mark flex h-9 w-9 items-center justify-center rounded-xl text-base font-black text-slate-900">
              B
            </span>
            <span className="leading-none">
              <span className="block text-[10px] font-extrabold uppercase tracking-[0.18em] text-amber-400">
                Yard · Demo
              </span>
              <span className="block text-lg font-extrabold tracking-tight">Trucki</span>
            </span>
          </Link>
          <div className="flex flex-wrap items-center gap-1.5" role="status" aria-label="Yard state">
            <span aria-label={online ? 'Online' : 'Offline'} className={online ? 'pill pill-live' : 'pill pill-warn'}>
              {online ? '● ONLINE' : '■ OFFLINE'}
            </span>
            <span className={live ? 'pill pill-live' : 'pill pill-demo'}>{live ? '● LIVE' : '■ PRACTICE'}</span>
            {pending > 0 && (
              <span role="status" className="pill pill-queued">⏳ {pending} queued</span>
            )}
            {critical > 0 && (
              <Link to="/alerts" className="pill pill-fail" role="alert">✖ {critical} critical</Link>
            )}
          </div>
          <span className="ml-auto hidden text-xs font-semibold text-white/60 md:inline">
            {displayName} · {role?.replace(/_/g, ' ') ?? 'signed out'}
          </span>
          {practice && (
            <label className="flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-white/5 px-2 py-1 text-xs font-bold text-amber-300">
              View as
              <select
                aria-label="Switch practice role"
                value={role ?? ''}
                onChange={(e) => {
                  const next = e.target.value as Role
                  signInDemo(next)
                  navigate(landingPathForRole(next))
                }}
                className="touch-target min-h-0 rounded bg-transparent py-0.5 pr-1 font-extrabold text-white [&>option]:text-slate-900"
              >
                {(['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER', 'EXECUTIVE', 'COMPLIANCE_OFFICER', 'ADMIN'] as Role[]).map((r) => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={async () => {
              try {
                await (await import('../lib/live')).signOutLive()
              } catch {
                // demo mode
              }
              signOut()
            }}
            className="touch-target rounded-lg border border-white/25 px-3 text-sm font-semibold text-white/85 hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
        {/* Weighted nav — 3 primary jobs, hub/guide + rest secondary (Hick's Law) */}
        <nav aria-label="Primary" className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 pb-2.5 pt-2">
          {visible(PRIMARY, role).map((item) => (
            <Link key={item.to} to={item.to} aria-current={pathname === item.to ? 'page' : undefined} className={linkCls(item.to)}>
              {item.label}
            </Link>
          ))}
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-white/20" />
          {visible(SECONDARY, role).map((item) => (
            <Link key={item.to} to={item.to} aria-current={pathname === item.to ? 'page' : undefined} className={linkCls(item.to)}>
              {item.label}
              {item.to === '/alerts' && critical > 0 && (
                <span className="tnum flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-extrabold text-white">
                  {critical}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
      <footer className="yard-foot mx-auto w-full max-w-6xl px-4 py-4 text-xs">
        Trucki · yard operations · {live ? 'connected' : 'training mode'} · Works offline — queued work syncs on reconnect.
      </footer>
    </div>
  )
}
