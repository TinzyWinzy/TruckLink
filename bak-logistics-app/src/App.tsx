import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import Layout from './components/Layout'
import { useSession, type Role } from './store/session'
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

/** Role gate per ROUTE_GATES. Mismatch renders a dead-end, never a redirect loop. */
function RoleGuard({ route, children }: { route: RouteKey; children: ReactNode }) {
  const { role, signOut } = useSession()
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
            onClick={() => {
              signOut()
            }}
          >
            Switch role →
          </button>
        </div>
      </Layout>
    )
  }
  return <>{children}</>
}

function Fallback() {
  return <p role="status" className="p-6 text-sm">Loading Trucki…</p>
}

/** Restore real yard sessions across refresh. Firebase Auth persists the
 * user, but the role lives in the store — without this, every reload drops
 * a signed-in staffer back to the gate. Practice sessions restore separately
 * from sessionStorage (session.ts); this handles real sign-ins only. */
function AuthRestore() {
  const { signInReal } = useSession()
  const navigate = useNavigate()
  useEffect(() => {
    let unsub: (() => void) | undefined
    let cancelled = false
    ;(async () => {
      try {
        const [{ auth }, { onAuthStateChanged }] = await Promise.all([
          import('./lib/firebase'),
          import('firebase/auth'),
        ])
        if (!auth || cancelled) return
        unsub = onAuthStateChanged(auth, (user) => {
          void (async () => {
            if (!user || cancelled) return
            try {
              const token = await user.getIdTokenResult()
              const r = token.claims.role as string | undefined
              const roles: Role[] = [
                'DISPATCH_SUPERVISOR',
                'FACILITY_MANAGER',
                'OPERATIONS_SUPERVISOR',
                'EXECUTIVE',
                'ADMIN',
                'COMPLIANCE_OFFICER',
              ]
              if (!r || !roles.includes(r as Role)) return
              if (useSession.getState().role) return // demo tap or fresh sign-in already holds the shift
              signInReal(user.uid, r as Role, user.displayName ?? user.email ?? 'Trucki user')
              if (window.location.pathname === '/') navigate(landingPathForRole(r as Role))
            } catch {
              // Token unreadable (offline boot) — staffer signs in again.
            }
          })()
        })
      } catch {
        // Demo mode (no Firebase) — nothing to restore.
      }
    })()
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [navigate, signInReal])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthRestore />
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
    </BrowserRouter>
  )
}
