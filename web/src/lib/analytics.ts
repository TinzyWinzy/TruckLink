// Phase 6 control-tower client. Server-backed when VITE_SYNC_API_URL is set,
// otherwise null (UI shows honest empty states — never fabricated numbers).

const BASE = (import.meta.env.VITE_SYNC_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export const isAnalyticsLive = (): boolean => BASE.length > 0

export interface HeatmapBucket {
  hour: number
  movements: number
  avgDwellMinutes: number | null
}

export interface SurgeStatus {
  queuedNow: number
  arrivalsLastHour: number
  threshold: number
  arrivalsThreshold: number
  surging: boolean
}

export interface RoiSummary {
  checksIntercepted: number
  overloadKgTotal: number
  finesInterceptedUsd: number
  pilotCostUsd: number
  paybackMultiple: number | null
}

async function get<T>(path: string): Promise<T | null> {
  if (!isAnalyticsLive()) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    // Identity: verified Firebase ID token (Bearer) — analytics endpoints are
    // facility-scoped to claims now, the shared key is gone (H1).
    const { auth } = await import('./firebase')
    const user = auth?.currentUser
    if (!user) return null
    const idToken = await user.getIdToken()
    const res = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${idToken}` },
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function fetchHeatmap(facilityId: string, days = 14): Promise<{ buckets: HeatmapBucket[] } | null> {
  return get<{ buckets: HeatmapBucket[] }>(`/api/analytics/heatmap?facilityId=${encodeURIComponent(facilityId)}&days=${days}`)
}

export function fetchSurge(facilityId: string): Promise<(SurgeStatus & { success: boolean }) | null> {
  return get<SurgeStatus & { success: boolean }>(`/api/analytics/surge?facilityId=${encodeURIComponent(facilityId)}`)
}

export function fetchRoi(facilityId: string, days = 30): Promise<(RoiSummary & { success: boolean }) | null> {
  return get<RoiSummary & { success: boolean }>(`/api/analytics/roi?facilityId=${encodeURIComponent(facilityId)}&days=${days}`)
}
