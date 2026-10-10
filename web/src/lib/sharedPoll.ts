/** A single in-flight read and timer shared by subscribers in one session scope. */
export function sharedPoll<T>(options: {
  scope: () => string | null
  load: (signal: AbortSignal) => Promise<T>
  intervalMs: number
}) {
  type Listener = { receive: (value: T) => void; error?: (message: string | null) => void }
  const groups = new Map<string, {
    listeners: Set<Listener>; stop: () => void; snapshot?: T; receivedAt: number; failed: boolean
  }>()

  return (receive: Listener['receive'], error?: Listener['error']): (() => void) | null => {
    const scope = options.scope()
    if (!scope) return null
    const listener: Listener = { receive, error }
    let group = groups.get(scope)
    if (!group) {
      const listeners = new Set<Listener>()
      let active = true, request: AbortController | null = null
      let timer: ReturnType<typeof setInterval>
      const stop = () => {
        if (!active) return
        active = false
        request?.abort()
        clearInterval(timer)
        document.removeEventListener('visibilitychange', visible)
        groups.delete(scope)
      }
      group = { listeners, stop, receivedAt: 0, failed: false }
      const current = group
      const tick = async () => {
        if (!active) return
        if (scope !== options.scope()) { stop(); return }
        if (request || document.hidden) return
        request = new AbortController()
        const timeout = setTimeout(() => request?.abort(), 12000)
        try {
          const value = await options.load(request.signal)
          if (!active || scope !== options.scope()) return
          current.snapshot = value
          current.receivedAt = Date.now()
          current.failed = false
          for (const sub of listeners) { sub.receive(value); sub.error?.(null) }
        } catch {
          if (!active || scope !== options.scope()) return
          current.failed = true
          for (const sub of listeners) sub.error?.('Server data unavailable. Displayed records may be stale. Retry when connected.')
        } finally { clearTimeout(timeout); request = null }
      }
      const visible = () => { if (!document.hidden) void tick() }
      document.addEventListener('visibilitychange', visible)
      timer = setInterval(() => void tick(), options.intervalMs)
      groups.set(scope, group)
      // Attach all subscribers mounted in this turn before starting the read.
      queueMicrotask(() => void tick())
    }
    group.listeners.add(listener)
    if (!group.failed && group.snapshot !== undefined && Date.now() - group.receivedAt < options.intervalMs) {
      receive(group.snapshot)
      error?.(null)
    }
    const current = group
    return () => {
      current.listeners.delete(listener)
      if (!current.listeners.size) current.stop()
    }
  }
}
