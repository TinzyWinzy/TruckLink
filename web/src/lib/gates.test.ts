import { describe, expect, it } from 'vitest'
import { ALERT_ACK_ROLES, ROUTE_GATES, canAckAlert, canVisit, landingPathForRole, type RouteKey } from './gates'
import { useSession, type Role } from '../store/session'

const ALL: Role[] = [
  'DISPATCH_SUPERVISOR',
  'FACILITY_MANAGER',
  'OPERATIONS_SUPERVISOR',
  'EXECUTIVE',
  'ADMIN',
  'COMPLIANCE_OFFICER',
]

describe('ROUTE_GATES (RBAC matrix)', () => {
  it('lands an unreleased tenant administrator on onboarding and preserves established tenants', () => {
    const previous = useSession.getState().workspace
    try {
      useSession.getState().setWorkspace({organisation:{id:91,name:'Synthetic Tenant',slug:'synthetic'},facilities:[],selectedFacility:'',configuration:{version:0,digest:'',release:null,modules:{yard:false,reports:false,audit:true},content:{schema_version:1,branding:{display_name:'Synthetic Tenant',accent:'#000000',navy:'#000000',paper:'#ffffff'},roles:{ADMIN:{label:'Admin',enabled:true}},permissions:{},workflow:{mandatory_checks:[],inspection_max_age_seconds:3600,escalation_minutes:{}},integrations:{}}}})
      expect(landingPathForRole('ADMIN')).toBe('/onboarding')
      expect(canVisit('onboarding','ADMIN')).toBe(true)
      expect(canVisit('onboarding','OPERATIONS_SUPERVISOR')).toBe(false)
      expect(canVisit('reports','ADMIN')).toBe(false)
    } finally { useSession.getState().setWorkspace(previous) }
  })
  it('denies signed-out visitors everywhere', () => {
    for (const route of Object.keys(ROUTE_GATES) as RouteKey[]) {
      expect(canVisit(route, null)).toBe(false)
    }
  })

  it('restricts admin + audit to their gates', () => {
    expect(canVisit('admin', 'ADMIN')).toBe(true)
    for (const r of ALL.filter((x) => x !== 'ADMIN')) expect(canVisit('admin', r)).toBe(false)
    for (const r of ['COMPLIANCE_OFFICER', 'ADMIN', 'EXECUTIVE', 'FACILITY_MANAGER'] as Role[]) {
      expect(canVisit('audit', r)).toBe(true)
    }
    expect(canVisit('audit', 'DISPATCH_SUPERVISOR')).toBe(false)
  })

  it('keeps yard flows with operational roles', () => {
    for (const r of ['DISPATCH_SUPERVISOR', 'OPERATIONS_SUPERVISOR', 'FACILITY_MANAGER'] as Role[]) {
      expect(canVisit('queue', r)).toBe(true)
      expect(canVisit('compliance', r)).toBe(true)
    }
    expect(canVisit('docks', 'DISPATCH_SUPERVISOR')).toBe(false)
    expect(canVisit('docks', 'OPERATIONS_SUPERVISOR')).toBe(true)
    expect(canVisit('reports', 'DISPATCH_SUPERVISOR')).toBe(false)
    expect(canVisit('reports', 'EXECUTIVE')).toBe(true)
  })

  it('lands every role on a visitable route (no permission-wall first screen)', () => {
    for (const r of ALL) {
      const path = landingPathForRole(r)
      const route = path.slice(1) as RouteKey
      expect(canVisit(route, r)).toBe(true)
    }
    expect(landingPathForRole('EXECUTIVE')).toBe('/reports')
    expect(landingPathForRole('COMPLIANCE_OFFICER')).toBe('/approvals')
    expect(landingPathForRole('DISPATCH_SUPERVISOR')).toBe('/queue')
  })

  it('keeps alert ack to update-capable roles (mirrors firestore.rules)', () => {
    for (const r of ALERT_ACK_ROLES) expect(canAckAlert(r)).toBe(true)
    for (const r of ['DISPATCH_SUPERVISOR', 'EXECUTIVE', 'COMPLIANCE_OFFICER'] as Role[]) {
      expect(canAckAlert(r)).toBe(false)
    }
    expect(canAckAlert(null)).toBe(false)
  })
})
