// Worker entrypoint (Phase 4): `npm run worker` (all) or
// `npm run worker -- --only=escalation,wms`.
// Requires RABBITMQ_URL — workers are the one component that needs a broker.

import { pool } from '../db.js'
import { assertTopology, QUEUES } from '../events/topology.js'
import { handleEscalationMessage } from './escalation.js'
import { handleWmsExportMessage } from './wmsExport.js'
import type { WmsTicket } from '../wms/adapter.js'
import { handleAuditMessage } from './auditVerify.js'
import { handleManifestMessage } from './manifestIngest.js'

const HANDLERS: Record<string, (msg: Record<string, unknown>, routingKey: string) => Promise<unknown>> = {
  [QUEUES.alertEscalation]: (m, rk) => handleEscalationMessage(m, rk),
  [QUEUES.wmsExport]: (m) => handleWmsExportMessage(m as unknown as WmsTicket),
  [QUEUES.auditVerify]: (m) => handleAuditMessage(m as { facilityId?: string }),
  [QUEUES.manifestIngest]: (m) => handleManifestMessage(m),
}

async function main(): Promise<void> {
  const url = process.env.RABBITMQ_URL
  if (!url) throw new Error('RABBITMQ_URL is required for workers (API runs broker-less).')
  const onlyFlag = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
  const only = new Set((onlyFlag ?? '').split(',').map((s) => s.trim()).filter(Boolean))

  const amqp = await import('amqplib')
  const conn = await amqp.connect(url)
  const ch = await conn.createChannel()
  await assertTopology(ch as never)
  await ch.prefetch(10)

  const queues = Object.values(QUEUES).filter((q) => {
    if (only.size === 0) return !q.includes('.wait.')
    return only.has(q)
  })

  for (const q of queues) {
    const handler = HANDLERS[q]
    if (!handler) continue
    await ch.consume(q, async (raw) => {
      if (!raw) return
      const routingKey = raw.fields.routingKey
      try {
        const body = JSON.parse(raw.content.toString()) as Record<string, unknown>
        await handler(body, routingKey)
        ch.ack(raw)
      } catch (err) {
        console.error(`[worker:${q}] failed:`, (err as Error).message)
        ch.nack(raw, false, false) // dead-letter / discard — no poison-message loop
      }
    })
  }

  console.log(`[workers] consuming: ${queues.join(', ')}`)
  process.on('SIGINT', () => void (async () => { await ch.close(); await conn.close(); await pool.end() })());
}

main().catch((err) => {
  console.error('[workers] fatal:', err)
  process.exit(1)
})
