import { selectFacility } from '../lib/api'
import { Link, useLocation } from 'react-router-dom'
import { listPendingActions, isOnline } from '../lib/offline/db'
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
  { to: '/modelling', label: 'Modelling', route: 'modelling' },
]

function visible(items: typeof PRIMARY, role: Role | null) {
  return items.filter((i) => canAccess(role, ROUTE_GATES[i.route]))
}

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { workspace, setWorkspace, role, baseRole, signInReal, userId, displayName, online, setOnline, signOut, signInDemo } = useSession()
  const practice = isPracticeSession(userId)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const [blocked, setBlocked] = useState(0)
  const [critical, setCritical] = useState(0)
  const live = useLive()

  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      const onlineNow = isOnline()
      if (onlineNow) {
        try {
          await (await import('../lib/live')).flushPendingActions()
        } catch {
          // Replay failures stay queued with retry counts; header shows the backlog.
        }
      }
      if (cancelled) return
      setOnline(onlineNow)
      try {
        const actions = (await listPendingActions()).filter((a) => a.actorId === userId || !a.actorId)
        if (cancelled) return
        setPending(actions.filter((a) => a.state !== 'BLOCKED').length)
        setBlocked(actions.filter((a) => a.state === 'BLOCKED').length)
      } catch {
        // IndexedDB blocked. keep last badge value.
      }
    }
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    const id = window.setInterval(sync, 5000)
    return () => {
      cancelled = true
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
      window.clearInterval(id)
    }
  }, [setOnline, pathname, userId])

  useEffect(() => {
    if (!live || !role) return
    let unsub: (() => void) | undefined
    let cancelled = false
    import('../lib/live').then((m) => {
      if (cancelled) return
      unsub = m.subscribe('alerts', (rows) =>
        setCritical(rows.filter((r) => String(r.status) === 'ACTIVE' && String(r.severity) === 'CRITICAL').length),
      ) ?? undefined
    })
    return () => { cancelled = true; unsub?.() }
  }, [live, role, userId])

  const linkCls = (to: string) => {
    const active = pathname === to
    const base = 'nav-pill touch-target inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold'
    if (active) return `${base} nav-active`
    return `${base} text-white/75 hover:bg-white/10 hover:text-white`
  }

  return (
    <div className="bak-workbench min-h-screen text-slate-900">
      <a href="#main-content" className="skip-link">Skip to workspace</a>
      <header className="gantry bak-masthead text-white">
        <div className="masthead-inner flex flex-wrap items-center gap-x-4 gap-y-3">
          <Link to={role ? landingPathForRole(role) : '/queue'} className="flex items-center gap-2.5" aria-label="Trucki home">
            <span aria-hidden="true" className="gantry-mark flex h-9 w-9 items-center justify-center rounded-xl text-base font-black text-slate-900">
              T
            </span>
            <span className="leading-none">
              <span className="block text-[10px] font-extrabold uppercase tracking-[0.18em] text-amber-400">
                {practice ? 'Practice workspace' : workspace?.organisation?.name ?? 'Operations workspace'}
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
            {blocked > 0 && (
              <span role="status" className="pill pill-warn" title="Saved locally; supervisor reconciliation required before retry">{blocked} need review</span>
            )}
            {critical > 0 && (
              <Link to="/alerts" className="pill pill-fail" role="alert">✖ {critical} critical</Link>
            )}
          </div>
          <span className="ml-auto hidden text-xs font-semibold text-white/60 md:inline">
            {displayName} · {role?.replace(/_/g, ' ') ?? 'signed out'}
          </span>
          {baseRole === 'ADMIN' && (
            <label className="flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-white/5 px-2 py-1 text-xs font-bold text-amber-300">
              View as
              <select
                aria-label={practice ? 'Switch practice role' : 'Switch working role'}
                disabled={switching || (!practice && !online)}
                value={role ?? ''}
                onChange={async (e) => {
                  const next = e.target.value as Role
                  setSwitchError(null)
                  if (practice) {
                    signInDemo(next)
                    navigate(landingPathForRole(next))
                    return
                  }
                  setSwitching(true)
                  try {
                    const session = await (await import('../lib/live')).switchRoleLive(next)
                    signInReal(session.uid, session.role, session.displayName, session.baseRole)
                    navigate(landingPathForRole(session.role))
                  } catch (error) {
                    setSwitchError((error as Error).message)
                  } finally {
                    setSwitching(false)
                  }
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
      </header>
      {switchError && <p role="alert" className="p-4 text-red-800">{switchError}</p>}
      {workspace && <div className="flex flex-wrap items-center gap-3 border-b border-slate-300 px-6 py-3 text-sm">
        <span className="font-semibold">{workspace.organisation?.name}</span>
        <label>Yard <select aria-label="Selected yard" className="field ml-2 px-3" value={workspace.selectedFacility} onChange={async e => {
          const id = e.target.value
          if (!workspace.facilities.some(f => String(f.id) === id)) return
          selectFacility(id)
          try { localStorage.setItem(`trucki-yard-${userId}`, id) } catch { /* storage unavailable */ }
          setWorkspace({ ...workspace, selectedFacility: id })
          navigate(landingPathForRole(role!))
        }}>{workspace.facilities.map(f => <option key={f.id} value={String(f.id)}>{f.name}</option>)}</select></label>
      </div>}
      <div className="workbench-body">
      <aside className="workspace-rail">
        <div className="rail-heading"><span className="eyebrow">Workspace</span><p>{role?.replace(/_/g, ' ').toLowerCase()}</p></div>
        {/* Weighted nav. 3 primary jobs, hub/guide + rest secondary (Hick's Law) */}
        <nav aria-label="Primary" className="workspace-navigation">
          {visible(PRIMARY, role).map((item) => (
            <Link key={item.to} to={item.to} aria-current={pathname === item.to ? 'page' : undefined} className={linkCls(item.to)}>
              {item.label}
            </Link>
          ))}
          <span aria-hidden="true" className="navigation-divider" />
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
        <p className="rail-note">Evidence before decision.<br />Approval before release.</p>
      </aside>
      <div className="workspace-content">
      <main id="main-content" tabIndex={-1} className="workspace-main">{children}</main>
      <footer className="yard-foot py-4 text-xs">
        Trucki · yard operations · {live ? 'connected' : 'training mode'} · Saved offline work is reviewed and retried on reconnect.
      </footer>
      </div>
      </div>
    </div>
  )
}
