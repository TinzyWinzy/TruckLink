// Audit verify worker (Phase 4.3): independent SHA-256 chain verification +
// cold-storage hook. Mirrors the app/Functions scheme:
//   hash = sha256(previousHash + JSON.stringify(payload) + salt)

import { createHash } from 'node:crypto'
import { pool } from '../db.js'

export function hashAuditEntry(previousHash: string, payload: string, salt: string): string {
  return createHash('sha256').update(`${previousHash}${payload}${salt}`).digest('hex')
}

interface AuditRow {
  id: string
  previous_hash: string
  hash: string
  payload: unknown
  action: string
}

export function requireAuditSalt(): string {
  const salt = process.env.AUDIT_SALT
  if (!salt) {
    // Fail-closed (H3): a missing salt must never silently "verify" against a default.
    throw new Error('AUDIT_SALT unset — refusing to verify the audit chain (fail-closed). See server/.env.example')
  }
  return salt
}

/** Returns first broken index, or -1 when the facility chain is intact. */
export async function verifyFacilityChain(facilityId: string): Promise<number> {
  const salt = requireAuditSalt()
  const res = await pool.query(
    `SELECT id, previous_hash, hash, payload, action FROM audit_logs
     WHERE facility_id = $1 ORDER BY timestamp ASC LIMIT 2000`,
    [facilityId],
  )
  const rows = res.rows as AuditRow[]
  let prev = 'GENESIS'
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.previous_hash !== prev) return i
    const payloadStr = typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload)
    if (hashAuditEntry(prev, payloadStr, salt) !== r.hash) return i
    prev = r.hash
  }
  return -1
}

export async function handleAuditMessage(msg: { facilityId?: string; auditId?: string }): Promise<'verified' | 'broken' | 'skipped'> {
  if (!msg.facilityId) return 'skipped'
  const brokenAt = await verifyFacilityChain(msg.facilityId)
  if (brokenAt >= 0) {
    console.error(`[audit.verify] BROKEN chain facility=${msg.facilityId} at index=${brokenAt}`)
    return 'broken'
  }
  if (process.env.S3_ARCHIVE_URL) {
    console.log(`[audit.verify] intact facility=${msg.facilityId} — archival hook configured (stub: POST ${process.env.S3_ARCHIVE_URL})`)
  } else {
    console.log(`[audit.verify] intact facility=${msg.facilityId} (archival not configured — pilot log)`)
  }
  return 'verified'
}
