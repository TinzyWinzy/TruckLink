// Web Push (SAD §10) — VAPID-native, Firebase-free. The tablet opts in once;
// the Django `notify` command then rings this device before WhatsApp/SMS.
// Requires VITE_VAPID_PUBLIC_KEY (py_vapid / generate_vapid_keys output) and
// a signed-in yard session (DRF Token auth via apiFetch).

import { apiFetch, isLive } from './api'

const VAPID = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? ''

export const isPushAvailable = (): boolean =>
  typeof window !== 'undefined' &&
  'Notification' in window &&
  'serviceWorker' in navigator &&
  isLive() &&
  VAPID.length > 0

export type PushState = 'unsupported' | 'denied' | 'off' | 'on' | 'error'

export async function pushState(): Promise<PushState> {
  if (!isPushAvailable()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'off'
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub ? 'on' : 'off'
  } catch {
    return 'error'
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

/** Request permission, subscribe via the service worker, register server-side. */
export async function subscribePush(userId: string, role: string): Promise<string> {
  if (!isPushAvailable()) throw new Error('Push not configured (VITE_VAPID_PUBLIC_KEY missing).')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission not granted.')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID),
    })
  }
  const keys = sub.toJSON().keys ?? {}
  await apiFetch('/push/subscribe/', {
    method: 'POST',
    body: { endpoint: sub.endpoint, keys, user_id: userId, role },
  })
  return sub.endpoint
}

/** Remove this device from the server and the browser. */
export async function unsubscribePush(): Promise<void> {
  if (!isPushAvailable()) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await apiFetch('/push/unsubscribe/', { method: 'POST', body: { endpoint: sub.endpoint } })
    await sub.unsubscribe()
  } catch {
    // Best-effort: a dead endpoint is pruned server-side on 404/410 anyway.
  }
}
