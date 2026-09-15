// Sync-upload allow-list (Phase: security posture — hardened).
// The upload endpoint previously interpolated the client-supplied table name
// straight into SQL. Only known tables/columns are writable now; anything
// else is rejected before touching Postgres. Privileged columns and audit
// chaining moved server-side: clients cannot set roles, billing flags, or
// forge audit hashes.

import { z } from 'zod'
import type { FirebaseIdentity } from './firebase/app.js'

/** Writable sync tables with their permitted columns. outbox_events is excluded. */
export const SYNC_TABLES: Record<string, ReadonlySet<string>> = {
  facilities: new Set(['name', 'created_at']),
  users: new Set(['name']),
  queue_entries: new Set([
    'facility_id', 'reg_number', 'driver_name', 'haulier', 'vehicle_type', 'cargo_type',
    'status', 'assigned_dock_id', 'entry_timestamp', 'exit_timestamp', 'dwell_duration_seconds',
    'created_at', 'updated_at',
  ]),
  docks: new Set(['facility_id', 'name', 'status', 'current_vehicle_id', 'updated_at']),
  compliance_checks: new Set([
    'facility_id', 'queue_id', 'reg_number', 'vehicle_type', 'route_type', 'axle_weights',
    'measured_total_kg', 'max_permissible_kg', 'overload_kg', 'overload_fee_usd',
    'checklist_results', 'status', 'inspector_id', 'timestamp', 'override_reason', 'override_authorizer_id',
  ]),
  alerts: new Set(['facility_id', 'severity', 'message', 'category', 'acknowledged', 'acknowledged_by', 'timestamp']),
  equipment: new Set(['facility_id', 'name', 'type', 'status', 'updated_at']),
}

/**
 * Tables the client may only hand *facts* to; the server owns the integrity —
 * e.g. audit_logs: the client supplies actor/action/payload, the server appends
 * prev/current hash inside a locked transaction (see audit/append.ts).
 */
export const SERVER_APPEND_TABLES: Record<string, ReadonlySet<string>> = {
  audit_logs: new Set(['facility_id', 'action', 'payload', 'actor_id', 'timestamp']),
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
  if (parsed.data.op !== 'DELETE') {
    if (!data || typeof data !== 'object') return { ok: false, error: 'PUT/PATCH requires data' }
    const writable = SYNC_TABLES[table] ?? SERVER_APPEND_TABLES[table]
    if (!writable) return { ok: false, error: `Unknown table: ${table}` }
    const bad = Object.keys(data).find((k) => !writable.has(k))
    if (bad) return { ok: false, error: `Unknown column ${table}.${bad}` }
  } else if (!SYNC_TABLES[table] && !SERVER_APPEND_TABLES[table]) {
    return { ok: false, error: `Unknown table: ${table}` }
  }
  return { ok: true, item: parsed.data }
}

/** Is this table client-writable generically (vs server-append)? */
export function isServerAppendTable(table: string): boolean {
  return table in SERVER_APPEND_TABLES
}

export function isSyncWritableTable(table: string): boolean {
  return table in SYNC_TABLES || table in SERVER_APPEND_TABLES
}

export type ScopeCheck = { ok: true } | { ok: false; error: string }

/**
 * Bind a batch item to the verified identity: the row's facility must be one of
 * the caller's facilities, and server-append actor_id must equal the caller's uid.
 */
export function assertItemScoped(item: BatchItem, identity: FirebaseIdentity | undefined): ScopeCheck {
  if (!isSyncWritableTable(item.table)) return { ok: false, error: `Unknown table: ${item.table}` }
  // Server-append tables (audit_logs) are write-once: the append path owns the
  // chain, so PATCH/DELETE would let a client rewrite or erase an audit fact.
  if (isServerAppendTable(item.table) && item.op !== 'PUT') {
    return { ok: false, error: `Forbidden: ${item.table} only supports PUT (server-chain append)` }
  }
  if (item.op === 'DELETE') return { ok: true }
  if (!identity) return { ok: false, error: 'Authenticated identity required' }
  const facilityId = (item.data as Record<string, unknown> | undefined)?.facility_id
  if (typeof facilityId === 'string' && !identity.facilities.includes(facilityId)) {
    return { ok: false, error: `Forbidden: ${item.table} row scoped to a facility you are not a member of` }
  }
  if (isServerAppendTable(item.table)) {
    const actor = (item.data as Record<string, unknown> | undefined)?.actor_id
    if (typeof actor === 'string' && actor !== identity.uid) {
      return { ok: false, error: `Forbidden: audit actor_id must match the authenticated user` }
    }
  }
  return { ok: true }
}