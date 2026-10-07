/**
 * Trucki REST client. Django/DRF backend (SAD v2 section 11).
 *
 * - `VITE_API_URL` set    -> yard system live (token auth, real facilities).
 * - `VITE_API_URL` unset  -> demo/practice mode; screens keep local seeds.
 * Firebase stays only for web push (push.ts / sw.ts); data never touches it.
 */

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
export const apiBase = BASE

// Live yard scope comes from the authenticated server identity, never a build-wide tenant.
export let facilityId = ''
export function selectFacility(id: string): void { facilityId = id }

const TOKEN_KEY = 'trucki-auth-token'
const REFRESH_KEY = 'trucki-refresh-token'
let sessionGeneration = 0
let refreshFlight: Promise<void> | null = null

export function setRefreshToken(token?: string): void {
  sessionGeneration++
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token)
    else localStorage.removeItem(REFRESH_KEY)
  } catch { /* Storage unavailable. */ }
}

export function hasSession(): boolean {
  try { return Boolean(getToken() || localStorage.getItem(REFRESH_KEY)) } catch { return Boolean(getToken()) }
}

async function refreshAccess(): Promise<void> {
  if (refreshFlight) return refreshFlight
  const generation = sessionGeneration
  refreshFlight = (async () => {
    let secret: string | null = null
    try { secret = localStorage.getItem(REFRESH_KEY) } catch { /* Storage unavailable. */ }
    if (!secret) {
      clearToken()
      throw new ApiError('Session expired. Please sign in again.', 401)
    }
    let response: Response
    try {
      response = await fetch(`${BASE}/api/auth/refresh/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refresh_token: secret }),
      })
    } catch { throw new ApiError('Network unreachable. Check the yard connection.', 0) }
    if (generation !== sessionGeneration) throw new ApiError('Session changed. Please retry.', 409)
    if (!response.ok) {
      if (response.status === 401) clearToken()
      throw new ApiError(response.status === 401 ? 'Session expired. Please sign in again.' : 'Session service unavailable. Please retry.', response.status)
    }
    const data = await response.json() as { token: string }
    if (generation !== sessionGeneration) throw new ApiError('Session changed. Please retry.', 409)
    setToken(data.token)
  })().finally(() => { refreshFlight = null })
  return refreshFlight
}

/** Live backend available (API base configured). Cheap. safe from any chunk. */
export function isLive(): boolean {
  return BASE.length > 0
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Private mode. session dies with the tab.
  }
}

export function clearToken(): void {
  sessionGeneration++
  selectFacility('')
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
  } catch {
    // Ignore.
  }
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function messageFrom(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (typeof d.detail === 'string' && d.detail) return d.detail
    if (typeof d.error === 'string' && d.error) return d.error
    if (d.errors && typeof d.errors === 'object') {
      const parts: string[] = []
      for (const [field, val] of Object.entries(d.errors as Record<string, unknown>)) {
        const msgs = Array.isArray(val) ? val.map(String).join(', ') : String(val)
        parts.push(`${field}: ${msgs}`)
      }
      if (parts.length) return parts.join(' · ')
    }
  }
  if (status === 401) return 'invalid credentials'
  if (status === 403) return 'not permitted for your role'
  return `Request failed (HTTP ${status})`
}

/** Fetch `/api${path}` with the session token; throws ApiError with the
 * server's message on any non-2xx. */
export async function apiFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; responseType?: 'json' | 'text'; signal?: AbortSignal } = {},
  retried = false,
): Promise<T> {
  const { method = 'GET', body } = init
  const headers: Record<string, string> = { Accept: 'application/json' }
  const anonymous = ['/auth/login/', '/auth/pin/', '/auth/register/', '/auth/refresh/', '/tenancy/signup/'].includes(path)
  if (!anonymous && !getToken() && hasSession()) await refreshAccess()
  const token = anonymous ? null : getToken()
  if (token) headers['Authorization'] = `Token ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      signal: init.signal,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('Network unreachable. Check the yard connection.', 0)
  }

  let data: unknown = null
  try {
    data = res.ok && init.responseType === 'text' ? await res.text() : await res.json()
  } catch {
    // Empty/non-JSON body. status still decides below.
  }
  if (res.status === 401 && !anonymous && !retried && hasSession()) {
    // Another concurrent request may already have renewed this access token.
    if (getToken() === token) await refreshAccess()
    return apiFetch<T>(path, init, true)
  }
  if (res.status === 401 && !anonymous && retried) clearToken()
  if (!res.ok) throw new ApiError(messageFrom(data, res.status), res.status)
  return data as T
}
