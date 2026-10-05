/**
 * Session-aware live gate. `isLive()` only answers "is the yard backend
 * configured?" — on a deployed site that is always true, so practice sessions
 * must ALSO be gated on a real yard sign-in. Otherwise practice taps poll the
 * API with no token -> 401 loops.
 *
 * - Components use `useLive()` (reactive — re-subscribes when the session flips).
 * - lib/live.ts uses `isRealLive()` (non-reactive read of the current state).
 */
import { isLive } from './api'
import { useSession, isPracticeSession } from '../store/session'

/** Yard backend configured (VITE_API_URL) AND a real (non-practice) session. */
export function isRealLive(): boolean {
  if (!isLive()) return false
  const userId = useSession.getState().userId
  return userId != null && !isPracticeSession(userId)
}

/** Reactive variant for components. */
export function useLive(): boolean {
  const userId = useSession((s) => s.userId)
  return isLive() && userId != null && !isPracticeSession(userId)
}
