// Phase 6 Postgres queries backing /api/analytics/*. All scoped by facility.

import { pool } from '../db.js'
import { bucketDwellByHour, checkSurge, summarizeRoi, type HeatmapBucket, type RoiSummary, type SurgeStatus } from './compute.js'

export async function getDwellHeatmap(facilityId: string, days = 14): Promise<HeatmapBucket[]> {
  const res = await pool.query(
    `SELECT EXTRACT(HOUR FROM entry_timestamp AT TIME ZONE 'Africa/Harare')::int AS "entryHour",
            dwell_duration_seconds / 60.0 AS "dwellMinutes"
     FROM queue_entries
     WHERE facility_id = $1 AND entry_timestamp >= NOW() - ($2 || ' days')::interval
     LIMIT 20000`,
    [facilityId, String(days)],
  )
  return bucketDwellByHour(res.rows as Array<{ entryHour: number; dwellMinutes: number | null }>)
}

export async function getSurgeStatus(facilityId: string): Promise<SurgeStatus> {
  const queued = await pool.query(
    `SELECT COUNT(*)::int AS n FROM queue_entries WHERE facility_id = $1 AND status = 'QUEUED'`,
    [facilityId],
  )
  const arrivals = await pool.query(
    `SELECT COUNT(*)::int AS n FROM queue_entries
     WHERE facility_id = $1 AND entry_timestamp >= NOW() - interval '1 hour'`,
    [facilityId],
  )
  const queuedNow = (queued.rows as Array<{ n: number }>)[0]?.n ?? 0
  const arrivalsLastHour = (arrivals.rows as Array<{ n: number }>)[0]?.n ?? 0
  return { queuedNow, arrivalsLastHour, ...checkSurge(queuedNow, arrivalsLastHour) }
}

export async function getRoi(facilityId: string, days = 30): Promise<RoiSummary> {
  const res = await pool.query(
    `SELECT overload_kg AS "overloadKg", overload_fee_usd AS "feeUsd"
     FROM compliance_checks
     WHERE facility_id = $1 AND status IN ('QUARANTINED', 'PENDING_OVERRIDE', 'OVERRIDE_APPROVED')
       AND timestamp >= NOW() - ($2 || ' days')::interval
     LIMIT 20000`,
    [facilityId, String(days)],
  )
  return summarizeRoi(
    (res.rows as Array<{ overloadKg: string | number; feeUsd: string | number }>).map((r) => ({
      overloadKg: Number(r.overloadKg),
      feeUsd: Number(r.feeUsd),
    })),
  )
}
