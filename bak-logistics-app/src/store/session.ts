import { create } from 'zustand'

export type Role =
  | 'DISPATCH_SUPERVISOR'
  | 'FACILITY_MANAGER'
  | 'OPERATIONS_SUPERVISOR'
  | 'EXECUTIVE'
  | 'ADMIN'
  | 'COMPLIANCE_OFFICER'

interface SessionState {
  userId: string | null
  role: Role | null
  displayName: string
  online: boolean
  signInDemo: (role: Role) => void
  signInReal: (userId: string, role: Role, displayName: string) => void
  signOut: () => void
  setOnline: (online: boolean) => void
}

export const useSession = create<SessionState>((set) => ({
  userId: null,
  role: null,
  displayName: 'Demo user',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  signInDemo: (role) =>
    set({ userId: `demo-${role.toLowerCase()}`, role, displayName: `Demo ${role.replace(/_/g, ' ')}` }),
  signInReal: (userId, role, displayName) => set({ userId, role, displayName }),
  signOut: () => set({ userId: null, role: null }),
  setOnline: (online) => set({ online }),
}))

export function canAccess(role: Role | null, allowed: Role[]): boolean {
  if (!role) return false
  return allowed.includes(role)
}
