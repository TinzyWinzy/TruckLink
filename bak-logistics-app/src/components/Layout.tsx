import { Link, useLocation } from 'react-router-dom'
import { pendingActionCount, pendingActionCountSyncInitial, isOnline } from '../lib/offline/db'
import { useSession, type Role, canAccess } from '../store/session'
import { useEffect, useState, type ReactNode } from 'react'
import { isLive } from '../lib/firebase'
import { ROUTE_GATES, landingPathForRole } from '../lib/gates'

const PRIMARY: { to: string; label: string; route: keyof typeof ROUTE_GATES }[] = [
  { to: '/queue', label: 'Queue', route: 'queue' },
  { to: '/compliance', label: 'Compliance', route: 'compliance' },
  { to: '/docks', label: 'Docks', route: 'docks' },
]

const SECONDARY: { to: string; label: string; route: keyof typeof ROUTE_GATES }[] = [
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
  const { role, displayName, online, setOnline, signOut } = useSession()
  const [pending, setPending] = useState(pendingActionCountSyncInitial)
  const [critical, setCritical] = useState(0)
  const live = isLive()

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

  const linkCls = (to: string, primary: boolean) => {
    const active = pathname === to
    const base = 'touch-target inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold'
    if (active) return `${base} bg-white text-slate-900 shadow-sm`
    return primary
      ? `${base} text-white/90 hover:bg-white/10`
      : `${base} text-white/65 hover:bg-white/10 hover:text-white`
  }

  return (
    <div className="min-h-screen text-slate-900">
      <header className="sticky top-0 z-10 bg-slate-900 text-white shadow-md">
        {/* Shift strip — glanceable yard state first (Pareto: exceptions before browsing) */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pt-3">
          <Link to={role ? landingPathForRole(role) : '/queue'} className="flex items-center gap-2 font-extrabold tracking-tight" aria-label="BAK Intel home">
            <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-sm font-black text-slate-900">
              B
            </span>
            BAK Intel
          </Link>
          <span role="status" aria-label={online ? 'Online' : 'Offline'} className={online ? 'pill pill-live' : 'pill pill-warn'}>
            {online ? '● ONLINE' : '■ OFFLINE'}
          </span>
          <span className={live ? 'pill pill-live' : 'pill pill-demo'}>{live ? '● STAGING' : '■ DEMO'}</span>
          {pending > 0 && (
            <span role="status" className="pill pill-queued">⏳ {pending} queued</span>
          )}
          {critical > 0 && (
            <Link to="/alerts" className="pill pill-fail" role="alert">✖ {critical} critical</Link>
          )}
          <span className="ml-auto hidden text-xs text-white/70 sm:inline">
            {displayName} · {role?.replace(/_/g, ' ') ?? 'signed out'}
          </span>
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
        {/* Weighted nav — 3 primary jobs, alerts flagged, rest secondary (Hick's Law) */}
        <nav aria-label="Primary" className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 pb-2 pt-1">
          {visible(PRIMARY, role).map((item) => (
            <Link key={item.to} to={item.to} aria-current={pathname === item.to ? 'page' : undefined} className={linkCls(item.to, true)}>
              {item.label}
            </Link>
          ))}
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-white/20" />
          {visible(SECONDARY, role).map((item) => (
            <Link key={item.to} to={item.to} aria-current={pathname === item.to ? 'page' : undefined} className={linkCls(item.to, false)}>
              {item.label}
              {item.to === '/alerts' && critical > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-extrabold text-white">
                  {critical}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-5">{children}</main>
    </div>
  )
}
