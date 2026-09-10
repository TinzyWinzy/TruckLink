/// <reference lib="webworker" />
// Custom service worker (injectManifest): Workbox precache + /api runtime
// cache + FCM background push. Replaces generateSW so push and offline
// caching share one worker registration.
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { initializeApp } from 'firebase/app'
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SAD §4.1: NetworkFirst for API reads (5s timeout, 24h / 100-entry cap).
registerRoute(
  /\/api\/.*$/i,
  new NetworkFirst({
    cacheName: 'api-runtime-cache',
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 })],
  }),
)

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId) {
  const fbApp = initializeApp(firebaseConfig)
  const messaging = getMessaging(fbApp)
  onBackgroundMessage(messaging, (payload) => {
    const data = (payload.data ?? {}) as Record<string, string>
    void self.registration.showNotification(payload.notification?.title ?? 'BAK OpShield', {
      body: payload.notification?.body ?? '',
      data: { url: data.url ?? '/alerts' },
    })
  })
}

self.addEventListener('notificationclick', (event) => {
  const e = event as unknown as {
    notification: { close(): void; data?: { url?: string } }
    waitUntil(p: Promise<unknown>): void
  }
  e.notification.close()
  const url = e.notification.data?.url ?? '/alerts'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('navigate' in w && w.url.includes(self.location.origin)) {
          return (w as WindowClient).navigate(url).then((c) => c?.focus())
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})

// Foreground fallback: app relays onMessage payloads here when no controller yet.
self.addEventListener('message', (event) => {
  const e = event as unknown as { data?: { type?: string; title?: string; body?: string } }
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    void self.registration.showNotification(e.data.title ?? 'BAK OpShield', {
      body: e.data.body ?? '',
      data: { url: '/alerts' },
    })
  }
})
