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
