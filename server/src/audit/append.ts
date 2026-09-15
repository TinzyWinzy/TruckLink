// Server-owned audit chain (Phase: security posture — H3/M3 fix).
// The client hands facts (actor/action/payload); this module appends the
// SHA-256 chain inside a per-facility locked row (audit_meta). Concurrent
// uploads for the same facility serialize on `SELECT ... FOR UPDATE`, so two
// tablets can never fork the chain. Fail-closed: no AUDIT_SALT, no append.

import { createHash } from 'node:crypto'
import type { BatchItem } from '../sync.js'

export interface PgClient {
  query(text: string, params?: unknown[]): Promise<{ rowCount: number; rows: Array<Record<string, unknown>> }>
}

export interface AuditAppendInput {
  id: string
  facilityId: string
  action: string
  payload: string
  actorId: string
  timestamp: string
}

export function requireAuditSalt(): string {
  const salt = process.env.AUDIT_SALT
  if (!salt) {
    throw new Error('AUDIT_SALT unset — refusing to append to the audit chain (fail-closed). See server/.env.example')
  }
  return salt
}

export function hashAuditEntry(previousHash: string, payload: string, salt: string): string {
  return createHash('sha256').update(`${previousHash}${payload}${salt}`).digest('hex')
}

/** Map a validated server-append batch item to the fields we store. */
export function auditItemToAppend(item: BatchItem): AuditAppendInput {
  const d = (item.data ?? {}) as Record<string, unknown>
  const rawPayload = d.payload ?? {}
  return {
    id: item.id,
    facilityId: String(d.facility_id ?? ''),
    action: String(d.action ?? 'UNKNOWN'),
    payload: typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload),
    actorId: String(d.actor_id ?? ''),
    timestamp: String(d.timestamp ?? new Date().toISOString()),
  }
}

/** Append one entry to the facility chain inside the caller's transaction. */
export async function appendAuditServer(client: PgClient, input: AuditAppendInput): Promise<void> {
  const salt = requireAuditSalt()
  // Reserve the per-facility ordering row (idempotent; concurrency-safe).
  await client.query(
    `INSERT INTO audit_meta (facility_id, current_hash, seq) VALUES ($1, 'GENESIS', 0)
     ON CONFLICT (facility_id) DO NOTHING`,
    [input.facilityId],
  )
  const meta = await client.query(
    `SELECT current_hash, seq FROM audit_meta WHERE facility_id = $1 FOR UPDATE`,
    [input.facilityId],
  )
  const previousHash = meta.rows[0]?.current_hash === undefined ? 'GENESIS' : String(meta.rows[0].current_hash)
  const seq = Number(meta.rows[0]?.seq ?? 0)
  const currentHash = hashAuditEntry(previousHash, input.payload, salt)

  const inserted = await client.query(
    `INSERT INTO audit_logs (id, facility_id, action, payload, actor_id, timestamp, previous_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [input.id, input.facilityId, input.action, input.payload, input.actorId, input.timestamp, previousHash, currentHash],
  )
  // Replays of the same offline id are no-ops: advancing the meta would
  // re-chain a hash that is already in the table.
  if (inserted.rowCount === 1) {
    await client.query(`UPDATE audit_meta SET current_hash = $2, seq = $3 WHERE facility_id = $1`, [
      input.facilityId,
      currentHash,
      seq + 1,
    ])
  }
}