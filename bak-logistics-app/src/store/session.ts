import { create } from 'zustand'

export type Role =
  | 'DISPATCH_SUPERVISOR'
  | 'FACILITY_MANAGER'
  | 'OPERATIONS_SUPERVISOR'
  | 'EXECUTIVE'
  | 'ADMIN'
  | 'COMPLIANCE_OFFICER'

/** Short slugs for shareable validation links: ?demo=1&role=dispatch (Econet-style deep link). */
export const ROLE_SLUGS: Record<string, Role> = {
  dispatch: 'DISPATCH_SUPERVISOR',
  operations: 'OPERATIONS_SUPERVISOR',
  facility: 'FACILITY_MANAGER',
  executive: 'EXECUTIVE',
  admin: 'ADMIN',
  compliance: 'COMPLIANCE_OFFICER',
}

export function roleFromSlug(raw: string | null): Role | null {
  if (!raw) return null
  return ROLE_SLUGS[raw.trim().toLowerCase()] ?? null
}

const DEMO_KEY = 'bak-practice-session'

interface DemoSession {
  role: Role
}

function loadDemoSession(): DemoSession | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    const raw = sessionStorage.getItem(DEMO_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DemoSession
    const roles: Role[] = [
      'DISPATCH_SUPERVISOR',
      'FACILITY_MANAGER',
      'OPERATIONS_SUPERVISOR',
      'EXECUTIVE',
      'ADMIN',
      'COMPLIANCE_OFFICER',
    ]
    if (!parsed || !roles.includes(parsed.role)) return null
    return { role: parsed.role }
  } catch {
    return null
  }
}

function saveDemoSession(role: Role): void {
  try {
    sessionStorage.setItem(DEMO_KEY, JSON.stringify({ role } satisfies DemoSession))
  } catch {
    // Private mode — session just won't survive refresh.
  }
}

function clearDemoSession(): void {
  try {
    sessionStorage.removeItem(DEMO_KEY)
  } catch {
    // Ignore.
  }
}

function demoDisplay(role: Role): { userId: string; displayName: string } {
  return { userId: `demo-${role.toLowerCase()}`, displayName: `${role.replace(/_/g, ' ')} (practice)` }
}

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

const initialDemo = loadDemoSession()
const initialIdentity = initialDemo ? demoDisplay(initialDemo.role) : null

export const useSession = create<SessionState>((set) => ({
  userId: initialIdentity?.userId ?? null,
  role: initialDemo?.role ?? null,
  displayName: initialIdentity?.displayName ?? 'Practice user',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  signInDemo: (role) => {
    saveDemoSession(role)
    set({ ...demoDisplay(role), role })
  },
  signInReal: (userId, role, displayName) => {
    clearDemoSession()
    set({ userId, role, displayName })
  },
  signOut: () => {
    clearDemoSession()
    set({ userId: null, role: null })
  },
  setOnline: (online) => set({ online }),
}))

/** Practice session (local-only) vs real yard sign-in. Only practice sessions may switch roles in place. */
export function isPracticeSession(userId: string | null): boolean {
  return userId != null && userId.startsWith('demo-')
}

export function canAccess(role: Role | null, allowed: Role[]): boolean {
  if (!role) return false
  return allowed.includes(role)
}
