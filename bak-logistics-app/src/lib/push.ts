// $0 push subscriptions (FCM). Tablet opts in once; the sync service then
// notifies this device free before trying WhatsApp/SMS. Requires
// VITE_FIREBASE_VAPID_KEY (Firebase console -> Project settings -> Cloud
// Messaging -> Web Push certificates) and VITE_SYNC_API_URL.

import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging'
import { getAuth } from 'firebase/auth'
import { app, facilityId } from './firebase'

const API = (import.meta.env.VITE_SYNC_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const VAPID = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined) ?? ''

export const isPushAvailable = (): boolean =>
  typeof window !== 'undefined' &&
  'Notification' in window &&
  'serviceWorker' in navigator &&
  API.length > 0 &&
  VAPID.length > 0

export type PushState = 'unsupported' | 'denied' | 'off' | 'on' | 'error'

export async function pushState(): Promise<PushState> {
  if (!isPushAvailable() || !(await isSupported().catch(() => false))) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.ready.catch(() => null)
  void reg
  return Notification.permission === 'granted' ? 'on' : 'off'
}

/** Request permission, fetch the FCM token, register with the sync service. */
export async function subscribePush(userId: string, role: string): Promise<string> {
  if (!app) throw new Error('Firebase not configured.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission not granted.')
  const messaging = getMessaging(app)
  const token = await getToken(messaging, { vapidKey: VAPID })
  // Identity: the server verifies the Firebase ID token; the shared API key is gone (H1).
  const auth = getAuth(app)
  const user = auth.currentUser
  if (!user) throw new Error('Sign in before subscribing to push.')
  const idToken = await user.getIdToken()
  const res = await fetch(`${API}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ userId, facilityId, role, fcmToken: token }),
  })
  if (!res.ok) throw new Error(`Subscribe failed: ${res.status}`)
  // Foreground messages while the app is open.
  onMessage(messaging, (payload) => {
    const title = payload.notification?.title ?? 'Trucki'
    const body = payload.notification?.body ?? ''
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SHOW_NOTIFICATION', title, body })
    } else {
      new Notification(title, { body })
    }
  })
  return token
}
