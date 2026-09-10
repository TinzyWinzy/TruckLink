// Manifest ingest worker (Phase 4.2 inbound / zero-typing gate arrival).
// Consumes q.manifest.ingest, validates, and pre-populates queue_entries so
// the gate tablet autocompletes on 3 letters of the plate. Idempotent on
// reference: replays of the same WMS notice are no-ops.

import { z } from 'zod'
import { pool } from '../db.js'

export const manifestSchema = z.object({
  reference: z.string().min(1),
  facilityId: z.string().min(1),
  regNumber: z.string().min(1).max(12),
  driverName: z.string().min(1).default('TBC'),
  haulier: z.string().min(1).default('TBC'),
  vehicleType: z.string().min(1).default('DEFAULT'),
  cargoType: z.string().min(1).default('TBC'),
})

export type ManifestInput = z.infer<typeof manifestSchema>

export async function handleManifestMessage(raw: unknown): Promise<'ingested' | 'duplicate'> {
  const m = manifestSchema.parse(raw)
  const res = await pool.query(
    `INSERT INTO queue_entries
       (id, facility_id, reg_number, driver_name, haulier, vehicle_type, cargo_type, status, entry_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'QUEUED', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [m.reference, m.facilityId, m.regNumber.toUpperCase(), m.driverName, m.haulier, m.vehicleType, m.cargoType],
  )
  return (res as unknown as { rowCount: number }).rowCount === 0 ? 'duplicate' : 'ingested'
}
