import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Fragment, Suspense, lazy, useEffect, useState, createContext, useContext, type ReactNode } from 'react'
import Layout from './components/Layout'
import { useSession } from './store/session'
import { canVisit, landingPathForRole, type RouteKey } from './lib/gates'

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
const AuthReady = createContext(false)

/** Role gate per ROUTE_GATES. Mismatch renders a dead-end, never a redirect loop. */
function RoleGuard({ route, children }: { route: RouteKey; children: ReactNode }) {
  const { role, signOut, userId } = useSession()
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
  return <Fragment key={`${userId}:${role}`}>{children}</Fragment>
}

function Fallback() {
  return <p role="status" className="p-6 text-sm">Loading Trucki…</p>
}

/** Restore real yard sessions across refresh. The API token persists in
 * localStorage; this revalidates it against /auth/me/ at boot. Practice
 * sessions restore separately from sessionStorage (session.ts). */
function AuthRestore({ onReady }: { onReady: (ready: boolean) => void }) {
  const { signInReal } = useSession()
  const navigate = useNavigate()
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { restoreSessionLive } = await import('./lib/live')
        if (useSession.getState().role) return // demo tap or fresh sign-in already holds the shift
        const s = await restoreSessionLive()
        if (!s || cancelled) return
        signInReal(s.uid, s.role, s.displayName, s.baseRole)
        if (window.location.pathname === '/') navigate(landingPathForRole(s.role))
      } catch {
        // Offline boot or dead token — staffer signs in again.
      } finally {
        if (!cancelled) onReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate, signInReal, onReady])
  return null
}

export default function App() {
  const [authReady, setAuthReady] = useState(false)
  return (
    <BrowserRouter>
      <AuthReady.Provider value={authReady}>
      <AuthRestore onReady={setAuthReady} />
      <Suspense fallback={<Fallback />}>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/queue" element={<RoleGuard route="queue"><Layout><QueueDashboard /></Layout></RoleGuard>} />
        <Route path="/docks" element={<RoleGuard route="docks"><Layout><DockBoard /></Layout></RoleGuard>} />
        <Route path="/compliance" element={<RoleGuard route="compliance"><Layout><ComplianceCheck /></Layout></RoleGuard>} />
        <Route path="/alerts" element={<RoleGuard route="alerts"><Layout><Alerts /></Layout></RoleGuard>} />
        <Route path="/reports" element={<RoleGuard route="reports"><Layout><Reports /></Layout></RoleGuard>} />
        <Route path="/audit" element={<RoleGuard route="audit"><Layout><AuditLog /></Layout></RoleGuard>} />
        <Route path="/admin" element={<RoleGuard route="admin"><Layout><Admin /></Layout></RoleGuard>} />
        <Route path="/hub" element={<RoleGuard route="hub"><Layout><Hub /></Layout></RoleGuard>} />
        <Route path="/guide" element={<RoleGuard route="guide"><Layout><Guide /></Layout></RoleGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
        </Suspense>
      </AuthReady.Provider>
    </BrowserRouter>
  )
}
