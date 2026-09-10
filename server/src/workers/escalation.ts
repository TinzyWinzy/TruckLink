// Escalation worker (Phase 4.1): 10m -> Facility Manager, 30m -> BDM.
// Consumes q.alert.escalation (quarantine notices + due timer callbacks).
// Skips any alert already acknowledged — ack is the single source of truth.

import { pool } from '../db.js'
import { getSmsGateway } from '../events/sms.js'

export interface EscalationMessage {
  checkId?: string
  facilityId?: string
  queueId?: string
  regNumber?: string
  overloadKg?: number
  overloadFeeUsd?: number
  dueAfter?: string
  escalateTo?: string
}

export function escalationTarget(msg: EscalationMessage, routingKey: string): string | null {
  if (routingKey.endsWith('due.10m') || msg.dueAfter === '10m') return 'FACILITY_MANAGER'
  if (routingKey.endsWith('due.30m') || msg.dueAfter === '30m') return 'BDM'
  return null // immediate quarantine notice: timers scheduled, nothing to send yet
}

function phoneFor(target: string): string | undefined {
  if (target === 'FACILITY_MANAGER') return process.env.MANAGER_PHONE
  if (target === 'BDM') return process.env.BDM_PHONE
  return process.env.SUPERVISOR_PHONE
}

async function isQuarantineAcknowledged(queueId: string | undefined): Promise<boolean> {
  if (!queueId) return false
  const res = await pool.query(
    `SELECT acknowledged FROM alerts WHERE id = $1 OR id = $2 LIMIT 1`,
    [`quar-${queueId}`, `alr-${queueId}`],
  )
  // Alerts use 0/1 (SQLite) or boolean (Postgres) — accept truthy.
  const row = (res.rows as Array<{ acknowledged: unknown }>)[0]
  return row ? row.acknowledged === true || row.acknowledged === 1 : false
}

/** Returns 'sent' | 'skipped-acked' | 'scheduled'. Throws on SMS failure (nack/retry). */
export async function handleEscalationMessage(
  msg: EscalationMessage,
  routingKey: string,
): Promise<'sent' | 'skipped-acked' | 'scheduled'> {
  const target = escalationTarget(msg, routingKey)
  if (!target) return 'scheduled'

  if (await isQuarantineAcknowledged(msg.queueId)) return 'skipped-acked'

  const to = phoneFor(target)
  const text =
    `BAK OpShield [${msg.dueAfter ?? ''} unacked]: ` +
    `${msg.regNumber ?? msg.queueId ?? 'vehicle'} quarantined ` +
    `(+${msg.overloadKg ?? '?'}kg, ~$${msg.overloadFeeUsd ?? '?'}). Ack in app or call the yard.`
  if (!to) {
    console.log(`[escalation:${target}] no phone configured — ${text}`)
    return 'sent'
  }
  await getSmsGateway().send(to, text)
  return 'sent'
}
