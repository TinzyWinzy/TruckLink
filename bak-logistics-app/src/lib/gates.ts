// Route-level RBAC matrix (mirrors firestore.rules + session.test.ts gates).
// Client-side only — Firestore rules and the sync-service allow-list are the
// real enforcement. Tested here so matrix drift fails the build, not the yard.

import { canAccess, type Role } from '../store/session'

export type RouteKey = 'queue' | 'docks' | 'compliance' | 'alerts' | 'reports' | 'audit' | 'admin'

export const ROUTE_GATES: Record<RouteKey, Role[]> = {
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
}

export function canVisit(route: RouteKey, role: Role | null): boolean {
  return canAccess(role, ROUTE_GATES[route])
}

/** Firestore `alerts` update gate mirrored client-side (firestore.rules alerts/update).
 * DISPATCH/EXECUTIVE/COMPLIANCE are read-only on alerts — the Acknowledge
 * button must stay hidden for them in both demo and live modes, otherwise
 * demo works and live denies (permission error). */
export const ALERT_ACK_ROLES: Role[] = ['OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER', 'ADMIN']

export function canAckAlert(role: Role | null): boolean {
  return canAccess(role, ALERT_ACK_ROLES)
}

/** Post-sign-in landing — every role must land on a route it canVisit.
 * Yard roles → /queue; EXECUTIVE/ADMIN → /reports; COMPLIANCE → /audit. */
export function landingPathForRole(role: Role): string {
  if (role === 'EXECUTIVE' || role === 'ADMIN') return '/reports'
  if (role === 'COMPLIANCE_OFFICER') return '/audit'
  return '/queue'
}
