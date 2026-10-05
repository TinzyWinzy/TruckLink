/// <reference lib="webworker" />
// Custom service worker: public shell precache and Web Push.
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Deployed updates must take over open tabs immediately. Without this the new
// worker waits until EVERY tab closes, so yard tablets keep serving the old
// precached bundle (stale code / stale permission behaviour) for days.
self.addEventListener('install', () => {
  void self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Retire the old URL-only cache; it could mix authenticated responses.
    await caches.delete('api-runtime-cache')
    await self.clients.claim()
  })())
})

// Private API reads are network-only until an actor/site-scoped snapshot store
// is implemented. The precached shell and durable offline write outbox remain.

// Background push (SAD §10): payload is {title, body, facility} from the
// Django notify command's pywebpush leg.
self.addEventListener('push', (event) => {
  const e = event as unknown as {
    data: { json(): unknown; text(): string } | null
    waitUntil(p: Promise<unknown>): void
  }
  e.waitUntil(
    (async () => {
      let title = 'Trucki'
      let body = ''
      let url = '/alerts'
      if (e.data) {
        try {
          const data = e.data.json() as Record<string, string>
          title = data.title ?? title
          body = data.body ?? body
          url = data.url ?? url
        } catch {
          body = e.data.text()
        }
      }
      await self.registration.showNotification(title, { body, data: { url } })
    })(),
  )
})

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
    void self.registration.showNotification(e.data.title ?? 'Trucki', {
      body: e.data.body ?? '',
      data: { url: '/alerts' },
    })
  }
})
