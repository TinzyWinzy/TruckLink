import express, { type Request, type Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import * as jose from 'jose'
import { z } from 'zod'
import { pool } from './db.js'
import { mapSyncItemToEvents, type DomainEvent } from './events/mapper.js'
import { insertOutbox, countPendingOutbox, listPendingOutbox, markOutboxDispatched } from './events/outbox.js'
import { getPublisher, isAllowedPublishKey } from './events/publisher.js'
import { EVENTS_EXCHANGE } from './events/topology.js'
import { manifestSchema, handleManifestMessage } from './workers/manifestIngest.js'
import { getDwellHeatmap, getSurgeStatus, getRoi } from './analytics/queries.js'
import { requireApiKey, authBootWarning } from './auth.js'
import { validateBatchItem } from './sync.js'

dotenv.config()

const app = express()
const port = process.env.PORT || 3000
const JWT_SECRET = new TextEncoder().encode(process.env.POWERSYNC_JWT_SECRET || 'secret-key-for-powersync-tokens-at-least-32-chars')

authBootWarning()

// CORS allow-list: exact origins comma-separated. Unset = open (dev only).
const corsOrigins = (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean)
app.use(cors(corsOrigins.length > 0 ? { origin: corsOrigins } : undefined))
app.use(express.json({ limit: '1mb' }))

// Minimal security headers (no extra dep).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Generate PowerSync JWT. Requires the API key; the Bearer value is the
// caller's asserted userId (pilot simplification — verify Firebase ID tokens
// here before multi-tenant prod, see SECURITY.md).
app.get('/api/auth/powersync-token', requireApiKey, async (req: Request, res: Response) => {
  try {
    // Identity comes from the validated query param (pilot simplification).
    const userId = typeof req.query.userId === 'string' && /^[A-Za-z0-9_@.+-]{1,128}$/.test(req.query.userId)
      ? req.query.userId
      : 'demo-user-id'
    const rawFacility = (req.query.facilityId as string) || 'demo-facility'
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(rawFacility)) {
      res.status(400).json({ error: 'Invalid facilityId' })
      return
    }
    const facilityId = rawFacility

    // PowerSync JWT with claims
    const token = await new jose.SignJWT({
      sub: userId,
      facility_id: facilityId
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(JWT_SECRET)

    res.json({
      token,
      endpoint: process.env.POWERSYNC_URL || 'https://sync.powersync.service',
      userId
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PowerSync Batch Upload Endpoint (transactional outbox: domain write + events
// commit atomically; relay to RabbitMQ happens after COMMIT, best-effort).
// Tables/columns are allow-listed (see sync.ts) — unknown names rejected.
app.post('/api/sync/upload', requireApiKey, async (req: Request, res: Response) => {
  const { batch } = req.body
  if (!Array.isArray(batch) || batch.length > 500) {
    res.status(400).json({ error: 'Expected batch array (max 500 items)' })
    return
  }

  const pending: Array<{ evt: DomainEvent; outboxId: string }> = []
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const raw of batch) {
      const checked = validateBatchItem(raw)
      if (!checked.ok) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: checked.error })
        return
      }
      const { op: opType, table, data, id } = checked.item
      const d = (data ?? {}) as Record<string, unknown>

      if (opType === 'PUT') {
        const keys = Object.keys(d)
        const values = Object.values(d)
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ')
        const updateSets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')

        const query = `
          INSERT INTO "${table}" ("id", ${keys.map(k => `"${k}"`).join(', ')})
          VALUES ($${keys.length + 1}, ${placeholders})
          ON CONFLICT ("id") DO UPDATE SET ${updateSets}
        `
        await client.query(query, [...values, id])
      } else if (opType === 'PATCH') {
        const keys = Object.keys(d)
        const values = Object.values(d)
        const updateSets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')

        const query = `
          UPDATE "${table}" SET ${updateSets} WHERE "id" = $${keys.length + 1}
        `
        await client.query(query, [...values, id])
      } else if (opType === 'DELETE') {
        await client.query(`DELETE FROM "${table}" WHERE "id" = $1`, [id])
      }

      for (const evt of mapSyncItemToEvents({ op: opType, table, data: d, id })) {
        const outboxId = await insertOutbox(client, evt.exchange, evt.routingKey, evt.payload)
        pending.push({ evt, outboxId })
      }
    }

    await client.query('COMMIT')
  } catch (err: any) {
    await client.query('ROLLBACK')
    console.error('Batch upload error:', err)
    res.status(500).json({ error: err.message })
    return
  } finally {
    client.release()
  }

  // Relay after commit — broker absence must never fail the tablet sync.
  try {
    const publisher = await getPublisher()
    if (publisher.connected) {
      const relayClient = await pool.connect()
      try {
        for (const { evt, outboxId } of pending) {
          try {
            await publisher.publish(evt.exchange, evt.routingKey, evt.payload)
            await markOutboxDispatched(relayClient, outboxId)
          } catch (err) {
            console.warn('[outbox] relay failed, stays pending:', (err as Error).message)
          }
        }
      } finally {
        relayClient.release()
      }
    }
  } catch (err) {
    console.warn('[outbox] publisher unavailable, events stay pending:', (err as Error).message)
  }
  res.json({ success: true, processedCount: batch.length, eventsQueued: pending.length })
})

// Outbox relay for the worker host: drains pending rows to the broker.
app.post('/api/events/relay', requireApiKey, async (_req: Request, res: Response) => {
  try {
    const rows = await listPendingOutbox(
      async (text, params) => ({ rows: (await pool.query(text, params)).rows }),
      200,
    )
    const publisher = await getPublisher()
    let relayed = 0
    for (const row of rows) {
      try {
        const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
        await publisher.publish(row.exchange, row.routingKey, payload)
        const client = await pool.connect()
        try {
          await markOutboxDispatched(client, row.id)
        } finally {
          client.release()
        }
        relayed += 1
      } catch (err) {
        console.warn('[outbox] relay item failed:', (err as Error).message)
        break
      }
    }
    res.json({ success: true, pending: rows.length, relayed })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Direct publish (allow-listed keys only) — for admin tooling, not tablets.
const publishSchema = z.object({
  routingKey: z.string().min(1),
  payload: z.record(z.unknown()),
})

app.post('/api/events/publish', requireApiKey, async (req: Request, res: Response) => {
  const parsed = publishSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Expected { routingKey, payload }' })
    return
  }
  if (!isAllowedPublishKey(parsed.data.routingKey)) {
    res.status(400).json({ error: 'Routing key not allow-listed' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await insertOutbox(client, EVENTS_EXCHANGE, parsed.data.routingKey, parsed.data.payload as Record<string, unknown>)
    await client.query('COMMIT')
  } catch (err: any) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: err.message })
    return
  } finally {
    client.release()
  }
  try {
    const publisher = await getPublisher()
    await publisher.publish(EVENTS_EXCHANGE, parsed.data.routingKey, parsed.data.payload as Record<string, unknown>)
  } catch (err) {
    console.warn('[events] direct publish stayed in outbox:', (err as Error).message)
  }
  res.json({ success: true })
})

// WMS inbound: legacy ERP drops an expected-dispatch notice; gate tablets
// autocomplete it via PowerSync. Works broker-less (direct insert).
app.post('/api/wms/manifest', requireApiKey, async (req: Request, res: Response) => {
  const parsed = manifestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid manifest', issues: parsed.error.issues })
    return
  }
  try {
    const result = await handleManifestMessage(parsed.data)
    try {
      const publisher = await getPublisher()
      await publisher.publish(EVENTS_EXCHANGE, 'queue.completed', {
        queueEntryId: parsed.data.reference,
        facilityId: parsed.data.facilityId,
        regNumber: parsed.data.regNumber,
        status: 'QUEUED',
        source: 'wms.manifest',
      })
    } catch {
      // Broker-less is fine — the row is already committed.
    }
    res.json({ success: true, result })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// WMS confirm (Phase 5 billing loop): ERP acknowledges the gate ticket.
// Idempotent — replays of the same confirmation are no-ops.
const confirmSchema = z.object({
  queueEntryId: z.string().min(1),
  erpReference: z.string().min(1),
})

app.post('/api/wms/confirm', requireApiKey, async (req: Request, res: Response) => {
  const parsed = confirmSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Expected { queueEntryId, erpReference }' })
    return
  }
  try {
    const result = await pool.query(
      `UPDATE queue_entries SET billed = TRUE, erp_reference = $2, updated_at = NOW()
       WHERE id = $1 AND (billed = FALSE OR erp_reference IS DISTINCT FROM $2)`,
      [parsed.data.queueEntryId, parsed.data.erpReference],
    )
    res.json({ success: true, result: result.rowCount === 0 ? 'duplicate' : 'confirmed' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Phase 6 control tower: dwell heatmap, surge status, ROI. Read-only.
function facilityQuery(req: Request): string | null {
  const f = req.query.facilityId
  return typeof f === 'string' && f.length > 0 && f.length <= 64 ? f : null
}

app.get('/api/analytics/heatmap', requireApiKey, async (req: Request, res: Response) => {
  const facilityId = facilityQuery(req)
  if (!facilityId) {
    res.status(400).json({ error: 'facilityId query param required' })
    return
  }
  try {
    res.json({ success: true, buckets: await getDwellHeatmap(facilityId, Number(req.query.days ?? 14)) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/analytics/surge', requireApiKey, async (req: Request, res: Response) => {
  const facilityId = facilityQuery(req)
  if (!facilityId) {
    res.status(400).json({ error: 'facilityId query param required' })
    return
  }
  try {
    res.json({ success: true, ...(await getSurgeStatus(facilityId)) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/analytics/roi', requireApiKey, async (req: Request, res: Response) => {
  const facilityId = facilityQuery(req)
  if (!facilityId) {
    res.status(400).json({ error: 'facilityId query param required' })
    return
  }
  try {
    res.json({ success: true, ...(await getRoi(facilityId, Number(req.query.days ?? 30))) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/events/status', async (_req: Request, res: Response) => {  try {
    const pending = await countPendingOutbox(async (text, params) => ({ rows: (await pool.query(text, params)).rows }))
    const publisher = await getPublisher()
    res.json({
      broker: publisher.connected ? 'connected' : 'disabled (RABBITMQ_URL unset — outbox mode)',
      outboxPending: pending,
      timestamp: new Date().toISOString(),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(port, () => {
  console.log(`[PowerSync Backend] Running on http://localhost:${port}`)
})
