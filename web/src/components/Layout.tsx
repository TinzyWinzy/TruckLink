import { selectFacility } from '../lib/api'
import { Link, useLocation } from 'react-router-dom'
import { listPendingActions, ownsPendingAction, isOnline } from '../lib/offline/db'
import { useSession, isPracticeSession, type Role } from '../store/session'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { useLive } from '../lib/liveGate'
import { ROUTE_GATES, canVisit, landingPathForRole } from '../lib/gates'
import { tenantLabel, tenantDisplayName } from '../lib/tenant'

const PRIMARY: { to: string; label: string; route: keyof typeof ROUTE_GATES }[] = [
  { to: '/consignments', label: 'Consignments', route: 'consignments' },
  { to: '/dispatch', label: 'Dispatch flow', route: 'dispatch' },
  { to: '/approvals', label: 'Pending approvals', route: 'approvals' },
  { to: '/evidence', label: 'Evidence', route: 'evidence' },
  { to: '/deliveries', label: 'Deliveries & exceptions', route: 'deliveries' },
  { to: '/routes', label: 'Routes & map', route: 'routes' },
  { to: '/queue', label: 'Queue', route: 'queue' },
  { to: '/compliance', label: 'Compliance', route: 'compliance' },
  { to: '/docks', label: 'Docks', route: 'docks' },
]

const SECONDARY: { to: string; label: string; route: keyof typeof ROUTE_GATES }[] = [
  { to: '/workspace', label: 'Workspace', route: 'workspace' },
  { to: '/onboarding', label: 'Onboarding', route: 'onboarding' },
  { to: '/recovery', label: 'Offline recovery', route: 'recovery' },
  { to: '/hub', label: 'Hub', route: 'hub' },
  { to: '/guide', label: 'Guide', route: 'guide' },
  { to: '/alerts', label: 'Alerts', route: 'alerts' },
  { to: '/reports', label: 'Reports', route: 'reports' },
  { to: '/audit', label: 'Audit', route: 'audit' },
  { to: '/admin', label: 'Admin', route: 'admin' },
  { to: '/modelling', label: 'Modelling', route: 'modelling' },
]

function visible(items: typeof PRIMARY, role: Role | null) {
  return items.filter((i) => canVisit(i.route,role))
}

const OVERVIEW_ROUTES = new Set(['workspace','reports','alerts'])
const NAV_GROUPS = [
  { label: 'Overview', items: SECONDARY.filter(item => OVERVIEW_ROUTES.has(item.route)) },
  { label: 'Operations', items: PRIMARY },
  { label: 'Management', items: SECONDARY.filter(item => !OVERVIEW_ROUTES.has(item.route)) },
]

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
  const [menuOpen, setMenuOpen] = useState(false)
  const live = useLive()
  const tenant = workspace?.configuration
  const brand = tenant?.content.branding
  useEffect(() => {
    if (!brand) return
    const root = document.documentElement
    root.style.setProperty('--transport-amber',brand.accent)
    root.style.setProperty('--transport-navy',brand.navy)
    root.style.setProperty('--transport-paper',brand.paper)
    return () => { for (const name of ['--transport-amber','--transport-navy','--transport-paper']) root.style.removeProperty(name) }
  }, [brand])

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
        const actions = (await listPendingActions()).filter(ownsPendingAction)
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
  }, [setOnline, pathname, userId, workspace?.selectedFacility])

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
  }, [live, role, userId, workspace?.selectedFacility])

  const linkCls = (to: string) => {
    const active = pathname === to
    const base = 'nav-pill'
    if (active) return `${base} nav-active`
    return base
  }

  return (
    <div className="transport-workbench min-h-screen text-slate-900">
      <a href="#main-content" className="skip-link">Skip to workspace</a>
      <header className="gantry transport-masthead text-white">
        <div className="masthead-inner">
          <Link to={role ? landingPathForRole(role) : '/queue'} className="workspace-brand" aria-label="Trucki home">
            <span aria-hidden="true" className="gantry-mark">
              T
            </span>
            <span className="brand-copy">
              <span className="brand-name">Trucki</span>
              <span className="brand-tenant" title={practice ? 'Practice workspace' : tenantDisplayName(tenant,workspace?.organisation?.name)}>
                {practice ? 'Practice workspace' : tenantDisplayName(tenant,workspace?.organisation?.name)}
              </span>
            </span>
          </Link>
      {workspace && <div className="header-yard">
        <label className="header-control"><span>Site</span><select aria-label="Selected yard" value={workspace.selectedFacility} onChange={async e => {
          const id = e.target.value
          if (!workspace.facilities.some(f => String(f.id) === id)) return
          selectFacility(id)
          try { localStorage.setItem(`trucki-yard-${userId}`, id) } catch { /* storage unavailable */ }
          setWorkspace({ ...workspace, selectedFacility: id })
          navigate(landingPathForRole(role!))
        }}>{workspace.facilities.map(f => <option key={f.id} value={String(f.id)}>{f.name}</option>)}</select></label>
      </div>}
          <div className="header-status" role="status" aria-label="Yard state">
            <span aria-label={online ? 'Online' : 'Offline'} className={`connection-state ${online?'is-online':'is-offline'}`}>
              <i aria-hidden="true"/>{online ? 'Online' : 'Offline'}
            </span>
            {!live&&<span className="pill pill-demo">■ PRACTICE</span>}
            {pending > 0 && (
              <Link to="/recovery" className="pill pill-queued">⏳ {pending} queued</Link>
            )}
            {blocked > 0 && (
              <Link to="/recovery" className="pill pill-warn" title="Review saved submissions on this device">{blocked} need review</Link>
            )}
            {critical > 0 && (
              <Link to="/alerts" className="pill pill-fail" role="alert">✖ {critical} critical</Link>
            )}
          </div>
          <div className="header-spacer"/>
          {baseRole === 'ADMIN' && (
            <label className="header-control header-role">
              <span>Working role</span>
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
              >
                {(['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER', 'EXECUTIVE', 'COMPLIANCE_OFFICER', 'ADMIN'] as Role[]).filter(r => tenant?.content.roles[r]?.enabled !== false).map((r) => (
                  <option key={r} value={r}>{tenantLabel(tenant,r)}</option>
                ))}
              </select>
            </label>
          )}
          <details className="account-menu">
            <summary><span className="account-avatar" aria-hidden="true">{displayName.trim().charAt(0).toUpperCase()||'U'}</span><span>Account</span><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg></summary>
            <div className="account-menu-panel"><p className="font-bold">{displayName}</p><p className="mt-1 mb-3 text-sm">{role ? tenantLabel(tenant,role) : 'Signed out'}</p>
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
          </button></div>
          </details>
        </div>
      </header>
      {switchError && <p role="alert" className="p-4 text-red-800">{switchError}</p>}
      <div className="workbench-body">
      <aside className="workspace-rail">
        <div className="rail-heading">
          <span className="rail-caption">Navigation</span>
          <span className="mobile-current-page">{[...PRIMARY, ...SECONDARY].find(item => item.to === pathname)?.label ?? 'Workspace'}</span>
          <button type="button" className="mobile-nav-toggle" aria-controls="workspace-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
            {menuOpen ? 'Close' : 'Menu'}
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d={menuOpen ? 'm5 5 10 10M15 5 5 15' : 'M3 5h14M3 10h14M3 15h14'}/>
            </svg>
          </button>
        </div>
        <nav id="workspace-navigation" aria-label="Primary" className={`workspace-navigation ${menuOpen ? 'is-open' : ''}`}>
          {NAV_GROUPS.map(group => {
            const items = visible(group.items, role)
            return items.length > 0 && (
              <div className="navigation-group" key={group.label}>
                <p className="navigation-group-title">{group.label}</p>
                {items.map(item => (
                  <Link key={item.to} to={item.to} onClick={() => setMenuOpen(false)} aria-current={pathname === item.to ? 'page' : undefined} className={linkCls(item.to)}>
                    <span>{item.label}</span>
                    {item.to === '/alerts' && critical > 0 && <span className="nav-alert-count">{critical}</span>}
                    {pathname === item.to && (
                      <svg className="nav-current-mark" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg>
                    )}
                  </Link>
                ))}
              </div>
            )
          })}
        </nav>
        <p className="rail-note">Evidence before decision.<br />Approval before release.</p>
      </aside>
      <div className="workspace-content">
      <main key={`${userId}:${workspace?.selectedFacility}:${role}`} id="main-content" tabIndex={-1} className="workspace-main">{children}</main>
      <footer className="yard-foot py-4 text-xs">
        Trucki · yard operations · {live ? 'connected' : 'training mode'} · Saved offline work is reviewed and retried on reconnect.
      </footer>
      </div>
      </div>
    </div>
  )
}
