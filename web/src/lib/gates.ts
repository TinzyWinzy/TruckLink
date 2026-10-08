// Route-level affordances. Django tenant/site permissions enforce actual access.

import { canAccess, useSession, type Role } from '../store/session'

export type RouteKey = 'onboarding' | 'consignments' | 'dispatch' | 'approvals' | 'queue' | 'docks' | 'compliance' | 'alerts' | 'reports' | 'audit' | 'admin' | 'hub' | 'guide' | 'modelling' | 'routes' | 'evidence' | 'deliveries' | 'recovery'

export const ROUTE_GATES: Record<RouteKey, Role[]> = {
  onboarding: ['ADMIN'],
  consignments: ['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','COMPLIANCE_OFFICER','EXECUTIVE','ADMIN'],
  evidence: ['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','COMPLIANCE_OFFICER','EXECUTIVE','ADMIN'],
  deliveries: ['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','COMPLIANCE_OFFICER','EXECUTIVE','ADMIN'],
  recovery: ['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','COMPLIANCE_OFFICER','EXECUTIVE','ADMIN'],
  dispatch: ['DISPATCH_SUPERVISOR','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','COMPLIANCE_OFFICER','EXECUTIVE','ADMIN'],
  approvals: ['COMPLIANCE_OFFICER','OPERATIONS_SUPERVISOR','FACILITY_MANAGER','ADMIN'],
  routes: ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER', 'EXECUTIVE', 'ADMIN', 'COMPLIANCE_OFFICER'],
  hub: ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER', 'EXECUTIVE', 'ADMIN', 'COMPLIANCE_OFFICER'],
  guide: ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER', 'EXECUTIVE', 'ADMIN', 'COMPLIANCE_OFFICER'],
  queue: ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER'],
  docks: ['OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER'],
  compliance: ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER','COMPLIANCE_OFFICER','ADMIN','EXECUTIVE'],
  alerts: [
    'DISPATCH_SUPERVISOR',
    'OPERATIONS_SUPERVISOR',
    'FACILITY_MANAGER',
    'EXECUTIVE',
    'ADMIN',
    'COMPLIANCE_OFFICER',
  ],
  reports: ['OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER', 'EXECUTIVE', 'ADMIN'],
  audit: ['COMPLIANCE_OFFICER', 'ADMIN', 'EXECUTIVE', 'FACILITY_MANAGER'],
  admin: ['ADMIN'],
  modelling: ['ADMIN', 'EXECUTIVE', 'FACILITY_MANAGER'],
}

export function canVisit(route: RouteKey, role: Role | null): boolean {
  if (!canAccess(role, ROUTE_GATES[route])) return false
  const tenant = useSession.getState().workspace?.configuration
  const config = tenant?.content
  const modules: Partial<Record<RouteKey,string>> = { consignments:'routing',evidence:'inspection',deliveries:'routing',recovery:'yard',dispatch:'yard',approvals:'inspection',queue:'yard',docks:'docks',compliance:'inspection',alerts:'yard',routes:'routing',reports:'reports',modelling:'modelling',audit:'audit' }
  if (modules[route] && tenant?.modules?.[modules[route]!] === false) return false
  const resource = route === 'dispatch'||route === 'approvals'||route === 'evidence' ? 'compliance' : route === 'deliveries'||route === 'consignments' ? 'routes' : route === 'recovery' ? 'queue' : route
  const allowed = config?.permissions[resource + '.read']
  return !config || (config.roles[role!]?.enabled !== false && (!allowed || allowed.includes(role!)))
}

/** Firestore `alerts` update gate mirrored client-side (firestore.rules alerts/update).
 * DISPATCH/EXECUTIVE/COMPLIANCE are read-only on alerts. the Acknowledge
 * button must stay hidden for them in both demo and live modes, otherwise
 * demo works and live denies (permission error). */
export const ALERT_ACK_ROLES: Role[] = ['OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER', 'ADMIN']

export function canAckAlert(role: Role | null): boolean {
  const allowed = useSession.getState().workspace?.configuration?.content.permissions['alerts.update']
  return canAccess(role, ALERT_ACK_ROLES) && (!allowed || !!role && allowed.includes(role))
}

/** Post-sign-in landing. every role must land on a route it canVisit.
 * Yard roles → /queue; EXECUTIVE/ADMIN → /reports; COMPLIANCE → /approvals. */
export function landingPathForRole(role: Role): string {
  const tenant = useSession.getState().workspace?.configuration
  if (role === 'ADMIN' && !tenant?.release && tenant?.modules?.yard === false) return '/onboarding'
  const preferred: RouteKey = role === 'EXECUTIVE' || role === 'ADMIN' ? 'reports' : role === 'COMPLIANCE_OFFICER' ? 'approvals' : 'queue'
  const route = [preferred, 'routes', 'hub'].find(key => canVisit(key as RouteKey,role)) ?? 'hub'
  return '/' + route
}
