// Phase 6 analytics: pure helpers (unit-tested) + Postgres queries.
// Definitions (pilot, Africa/Harare wall-clock approximated in UTC+2):
// - Dwell heatmap: avg dwell minutes + movement count per entry-hour bucket.
// - Surge: QUEUED count vs SURGE_QUEUE_THRESHOLD (default 15) and arrivals
//   in the last hour vs SURGE_ARRIVALS_THRESHOLD (default 10).
// - ROI: overload fines INTERCEPTED at the gate = SUM(overload_fee_usd) over
//   QUARANTINED / PENDING_OVERRIDE / OVERRIDE_APPROVED checks. Honest label:
//   these are fines BAK would have risked downstream, not cash collected.

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

export const PILOT_COST_USD = 6200

/** Bucket dwell samples (minutes) by entry hour 0-23. Pure. */
export function bucketDwellByHour(
  samples: Array<{ entryHour: number; dwellMinutes: number | null }>,
): HeatmapBucket[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    movements: 0,
    dwellSum: 0,
    dwellN: 0,
  }))
  for (const s of samples) {
    if (s.entryHour < 0 || s.entryHour > 23) continue
    const b = buckets[s.entryHour]
    b.movements += 1
    if (s.dwellMinutes != null && s.dwellMinutes >= 0) {
      b.dwellSum += s.dwellMinutes
      b.dwellN += 1
    }
  }
  return buckets.map((b) => ({
    hour: b.hour,
    movements: b.movements,
    avgDwellMinutes: b.dwellN === 0 ? null : Math.round((b.dwellSum / b.dwellN) * 10) / 10,
  }))
}

/** Pure surge decision from counts. */
export function checkSurge(queuedNow: number, arrivalsLastHour: number): Omit<SurgeStatus, 'queuedNow' | 'arrivalsLastHour'> {
  const threshold = Number(process.env.SURGE_QUEUE_THRESHOLD ?? 15)
  const arrivalsThreshold = Number(process.env.SURGE_ARRIVALS_THRESHOLD ?? 10)
  return {
    threshold,
    arrivalsThreshold,
    surging: queuedNow >= threshold || arrivalsLastHour >= arrivalsThreshold,
  }
}

/** Pure ROI roll-up from intercepted-check rows. */
export function summarizeRoi(
  rows: Array<{ overloadKg: number; feeUsd: number }>,
): RoiSummary {
  const fines = rows.reduce((a, r) => a + (Number.isFinite(r.feeUsd) ? r.feeUsd : 0), 0)
  const kg = rows.reduce((a, r) => a + (Number.isFinite(r.overloadKg) ? r.overloadKg : 0), 0)
  const finesRounded = Math.round(fines * 100) / 100
  return {
    checksIntercepted: rows.length,
    overloadKgTotal: Math.round(kg),
    finesInterceptedUsd: finesRounded,
    pilotCostUsd: PILOT_COST_USD,
    paybackMultiple: finesRounded > 0 ? Math.round((finesRounded / PILOT_COST_USD) * 100) / 100 : null,
  }
}
