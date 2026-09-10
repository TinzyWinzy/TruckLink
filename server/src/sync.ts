// Sync-upload allow-list (Phase: security posture).
// The upload endpoint previously interpolated the client-supplied table name
// straight into SQL. Only known tables/columns are writable now; anything
// else is rejected before touching Postgres. Pure — unit-tested.

import { z } from 'zod'

/** Writable sync tables with their permitted columns. outbox_events is excluded. */
export const SYNC_TABLES: Record<string, ReadonlySet<string>> = {
  facilities: new Set(['name', 'created_at']),
  users: new Set(['email', 'role', 'facility_id', 'name']),
  queue_entries: new Set([
    'facility_id', 'reg_number', 'driver_name', 'haulier', 'vehicle_type', 'cargo_type',
    'status', 'assigned_dock_id', 'entry_timestamp', 'exit_timestamp', 'dwell_duration_seconds',
    'billed', 'erp_reference', 'created_at', 'updated_at',
  ]),
  docks: new Set(['facility_id', 'name', 'status', 'current_vehicle_id', 'updated_at']),
  compliance_checks: new Set([
    'facility_id', 'queue_id', 'reg_number', 'vehicle_type', 'route_type', 'axle_weights',
    'measured_total_kg', 'max_permissible_kg', 'overload_kg', 'overload_fee_usd',
    'checklist_results', 'status', 'inspector_id', 'timestamp', 'override_reason', 'override_authorizer_id',
  ]),
  audit_logs: new Set(['facility_id', 'action', 'payload', 'actor_id', 'timestamp', 'previous_hash', 'hash']),
  alerts: new Set(['facility_id', 'severity', 'message', 'category', 'acknowledged', 'acknowledged_by', 'timestamp']),
  equipment: new Set(['facility_id', 'name', 'type', 'status', 'updated_at']),
}

export const batchItemSchema = z.object({
  op: z.enum(['PUT', 'PATCH', 'DELETE']),
  table: z.string().min(1).max(64),
  id: z.string().min(1).max(128),
  data: z.record(z.unknown()).optional(),
})

export type BatchItem = z.infer<typeof batchItemSchema>

/** Unknown table, unknown column, or wrong shape -> human-readable error. */
export function validateBatchItem(raw: unknown): { ok: true; item: BatchItem } | { ok: false; error: string } {
  const parsed = batchItemSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Invalid batch item shape' }
  const { table, data } = parsed.data
  const columns = SYNC_TABLES[table]
  if (!columns) return { ok: false, error: `Unknown table: ${table}` }
  if (parsed.data.op !== 'DELETE') {
    if (!data || typeof data !== 'object') return { ok: false, error: 'PUT/PATCH requires data' }
    const bad = Object.keys(data).find((k) => !columns.has(k))
    if (bad) return { ok: false, error: `Unknown column ${table}.${bad}` }
  }
  return { ok: true, item: parsed.data }
}
