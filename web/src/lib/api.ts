/**
 * Trucki REST client — Django/DRF backend (SAD v2 section 11).
 *
 * - `VITE_API_URL` set    -> yard system live (token auth, real facilities).
 * - `VITE_API_URL` unset  -> demo/practice mode; screens keep local seeds.
 * Firebase stays only for web push (push.ts / sw.ts); data never touches it.
 */

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export const facilityId =
  (import.meta.env.VITE_FACILITY_ID as string | undefined) ?? 'demo-facility'

const TOKEN_KEY = 'trucki-auth-token'

/** Live backend available (API base configured). Cheap — safe from any chunk. */
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
    // Private mode — session dies with the tab.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
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
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { method = 'GET', body } = init
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Token ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('Network unreachable — check the yard connection.', 0)
  }

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // Empty/non-JSON body — status still decides below.
  }
  if (!res.ok) throw new ApiError(messageFrom(data, res.status), res.status)
  return data as T
}
