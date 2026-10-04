/**
 * Session-aware live gate. `isLive()` only answers "is Firebase configured?" —
 * on the deployed site that is always true, so practice sessions must ALSO be
 * gated on a real yard sign-in. Otherwise practice taps hit Firestore with no
 * auth claims -> permission-denied (e.g. BatchGetDocuments on docks/D3).
 *
 * - Components use `useLive()` (reactive — re-subscribes when the session flips).
 * - lib/live.ts uses `isRealLive()` (non-reactive read of the current state).
 */
import { isLive } from './firebase'
import { useSession, isPracticeSession } from '../store/session'

/** Firebase configured AND a real (non-practice) session is active. */
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
