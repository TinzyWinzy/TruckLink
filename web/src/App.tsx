import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Fragment, Suspense, lazy, useEffect, useState, createContext, useContext, type ReactNode } from 'react'
import Layout from './components/Layout'
import { useSession } from './store/session'
import { canVisit, landingPathForRole, type RouteKey } from './lib/gates'

const Modelling = lazy(() => import('./routes/Modelling'))
const RoutesMap = lazy(() => import('./routes/RoutesMap'))
const Login = lazy(() => import('./routes/Login'))
const QueueDashboard = lazy(() => import('./routes/QueueDashboard'))
const DockBoard = lazy(() => import('./routes/DockBoard'))
const ComplianceCheck = lazy(() => import('./routes/ComplianceCheck'))
const Alerts = lazy(() => import('./routes/Alerts'))
const Reports = lazy(() => import('./routes/Reports'))
const AuditLog = lazy(() => import('./routes/AuditLog'))
const Admin = lazy(() => import('./routes/Admin'))
const Hub = lazy(() => import('./routes/Hub'))
const Guide = lazy(() => import('./routes/Guide'))
const DispatchFlow = lazy(() => import('./routes/DispatchFlow'))
const PendingApprovals = lazy(() => import('./routes/PendingApprovals'))
const Evidence = lazy(() => import('./routes/Evidence'))
const Deliveries = lazy(() => import('./routes/Deliveries'))
const Recovery = lazy(() => import('./routes/Recovery'))
const Consignments = lazy(() => import('./routes/Consignments'))
const Onboarding = lazy(() => import('./routes/Onboarding'))
const AuthReady = createContext(false)

/** Role gate per ROUTE_GATES. Mismatch renders a dead-end, never a redirect loop. */
function RoleGuard({ route, children }: { route: RouteKey; children: ReactNode }) {
  const { workspace, role, signOut, userId } = useSession()
  const authReady = useContext(AuthReady)
  if (!role && !authReady) return <Fallback />
  if (!role) return <Navigate to="/" replace />
  if (!canVisit(route, role)) {
    return (
      <Layout>
        <div className="card mx-auto mt-10 max-w-md p-6 text-center">
          <p className="text-lg font-extrabold">Not permitted</p>
          <p className="mt-1 text-sm text-slate-600">
            {role.replace(/_/g, ' ')} cannot open {route}. Sign in with the covering role.
          </p>
          <button
            type="button"
            className="btn-primary touch-target mt-4 w-full px-4"
            onClick={async () => {
              await (await import('./lib/live')).signOutLive()
              signOut()
            }}
          >
            Switch role →
          </button>
        </div>
      </Layout>
    )
  }
  // Identity changes remount private screens before they can display old rows.
  return <Fragment key={`${userId}:${role}:${workspace?.selectedFacility}`}>{children}</Fragment>
}

function Fallback() {
  return <p role="status" className="p-6 text-sm">Loading Trucki…</p>
}

/** Restore real yard sessions across refresh. The API token persists in
 * localStorage; this revalidates it against /auth/me/ at boot. Practice
 * sessions restore separately from sessionStorage (session.ts). */
function AuthRestore({ onReady, onError, retry }: { onReady: (ready: boolean) => void; onError: (message: string) => void; retry: number }) {
  const { signInReal } = useSession()
  const navigate = useNavigate()
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { restoreSessionLive } = await import('./lib/live')
        if (useSession.getState().role) { if (!cancelled) onReady(true); return }
        const s = await restoreSessionLive()
        if (cancelled) return
        if (!s) { onReady(true); return }
        signInReal(s.uid, s.role, s.displayName, s.baseRole)
        if (window.location.pathname === '/') navigate(landingPathForRole(s.role))
        if (!cancelled) onReady(true)
      } catch {
        if (!cancelled) onError('Your session is saved. We could not reconnect to the server. Check your connection and retry.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate, signInReal, onReady, onError, retry])
  return null
}

export default function App() {
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  const [retry, setRetry] = useState(0)
  return (
    <BrowserRouter>
      <AuthReady.Provider value={authReady}>
      <AuthRestore onReady={setAuthReady} onError={setAuthError} retry={retry} />
      {authError ? <div className="card mx-auto mt-10 max-w-md p-6" role="alert">
        <p>{authError}</p>
        <button className="btn-primary mt-4 px-4" onClick={() => { setAuthError(''); setRetry(v => v + 1) }}>Retry connection</button>
      </div> : !authReady ? <Fallback /> : <>
      <Suspense fallback={<Fallback />}>
      <Routes>
        <Route path="/onboarding" element={<RoleGuard route="onboarding"><Layout><Onboarding /></Layout></RoleGuard>} />
        <Route path="/consignments" element={<RoleGuard route="consignments"><Layout><Consignments /></Layout></RoleGuard>} />
        <Route path="/evidence" element={<RoleGuard route="evidence"><Layout><Evidence /></Layout></RoleGuard>} />
        <Route path="/deliveries" element={<RoleGuard route="deliveries"><Layout><Deliveries /></Layout></RoleGuard>} />
        <Route path="/recovery" element={<RoleGuard route="recovery"><Layout><Recovery /></Layout></RoleGuard>} />
        <Route path="/dispatch" element={<RoleGuard route="dispatch"><Layout><DispatchFlow /></Layout></RoleGuard>} />
        <Route path="/approvals" element={<RoleGuard route="approvals"><Layout><PendingApprovals /></Layout></RoleGuard>} />
        <Route path="/routes" element={<RoleGuard route="routes"><Layout><RoutesMap /></Layout></RoleGuard>} />
        <Route path="/" element={<Login />} />
        <Route path="/queue" element={<RoleGuard route="queue"><Layout><QueueDashboard /></Layout></RoleGuard>} />
        <Route path="/docks" element={<RoleGuard route="docks"><Layout><DockBoard /></Layout></RoleGuard>} />
        <Route path="/compliance" element={<RoleGuard route="compliance"><Layout><ComplianceCheck /></Layout></RoleGuard>} />
        <Route path="/alerts" element={<RoleGuard route="alerts"><Layout><Alerts /></Layout></RoleGuard>} />
        <Route path="/reports" element={<RoleGuard route="reports"><Layout><Reports /></Layout></RoleGuard>} />
        <Route path="/audit" element={<RoleGuard route="audit"><Layout><AuditLog /></Layout></RoleGuard>} />
        <Route path="/modelling" element={<RoleGuard route="modelling"><Layout><Modelling /></Layout></RoleGuard>} />
        <Route path="/admin" element={<RoleGuard route="admin"><Layout><Admin /></Layout></RoleGuard>} />
        <Route path="/hub" element={<RoleGuard route="hub"><Layout><Hub /></Layout></RoleGuard>} />
        <Route path="/guide" element={<RoleGuard route="guide"><Layout><Guide /></Layout></RoleGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
        </Suspense>
      </>}
      </AuthReady.Provider>
    </BrowserRouter>
  )
}
