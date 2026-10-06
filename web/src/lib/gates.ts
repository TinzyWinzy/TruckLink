// Route-level RBAC matrix (mirrors firestore.rules + session.test.ts gates).
// Client-side only. Firestore rules and the sync-service allow-list are the
// real enforcement. Tested here so matrix drift fails the build, not the yard.

import { canAccess, useSession, type Role } from '../store/session'

export type RouteKey = 'queue' | 'docks' | 'compliance' | 'alerts' | 'reports' | 'audit' | 'admin' | 'hub' | 'guide' | 'modelling' | 'routes'

export const ROUTE_GATES: Record<RouteKey, Role[]> = {
  routes: ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER', 'EXECUTIVE', 'ADMIN', 'COMPLIANCE_OFFICER'],
  hub: ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER', 'EXECUTIVE', 'ADMIN', 'COMPLIANCE_OFFICER'],
  guide: ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER', 'EXECUTIVE', 'ADMIN', 'COMPLIANCE_OFFICER'],
  queue: ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER'],
  docks: ['OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER'],
  compliance: ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER'],
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
  const config = useSession.getState().workspace?.configuration?.content
  const resource = route === 'audit' ? 'audit' : route
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
 * Yard roles → /queue; EXECUTIVE/ADMIN → /reports; COMPLIANCE → /audit. */
export function landingPathForRole(role: Role): string {
  const preferred: RouteKey = role === 'EXECUTIVE' || role === 'ADMIN' ? 'reports' : role === 'COMPLIANCE_OFFICER' ? 'audit' : 'queue'
  const route = [preferred, 'routes', 'hub'].find(key => canVisit(key as RouteKey,role)) ?? 'hub'
  return '/' + route
}
