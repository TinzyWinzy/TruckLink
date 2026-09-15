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
import {
  assertBootSecrets,
  identityHasFacility,
  requireApiKey,
  requireFirebaseIdentity,
  requireWmsKey,
} from './auth.js'
import {
  assertItemScoped,
  isServerAppendTable,
  validateBatchItem,
  type BatchItem,
} from './sync.js'
import { appendAuditServer, auditItemToAppend, type PgClient as AuditClient } from './audit/append.js'

dotenv.config()

const app = express()
const port = process.env.PORT || 3000

// Fail-closed: no public fallback secret any more. Devs copy server/.env.example.
const jwtSecretValue = process.env.POWERSYNC_JWT_SECRET
if (!jwtSecretValue || jwtSecretValue.length < 32) {
  throw new Error('POWERSYNC_JWT_SECRET required (32+ chars) — copy server/.env.example before starting.')
}
const JWT_SECRET = new TextEncoder().encode(jwtSecretValue)

assertBootSecrets()

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

// Never leak internal error strings to clients (L2).
function fail(res: Response, err: unknown): void {
  console.error('Request error:', err instanceof Error ? err.stack ?? err.message : err)
  res.status(500).json({ error: 'Internal server error' })
}

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Generate PowerSync JWT. Caller identity comes from the verified Firebase ID
// token (custom claims {role, facilities}); the API key no longer grants identities.
app.get('/api/auth/powersync-token', requireFirebaseIdentity, async (req: Request, res: Response) => {
  try {
    const identity = req.identity as NonNullable<typeof req.identity>
    const requested = typeof req.query.facilityId === 'string' ? req.query.facilityId : ''
    const facilityId = identity.facilities[0] ?? ''
    if (requested && !identity.facilities.includes(requested)) {
      res.status(403).json({ error: 'Forbidden: requested facility not in your claims' })
      return
    }
    if (!facilityId) {
      res.status(403).json({ error: 'Account has no facility claim — ask an ADMIN to set facilities' })
      return
    }

    const token = await new jose.SignJWT({
      sub: identity.uid,
      facility_id: facilityId,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(JWT_SECRET)

    res.json({
      token,
      endpoint: process.env.POWERSYNC_URL || 'https://sync.powersync.service',
      userId: identity.uid,
    })
  } catch (err) {
    fail(res, err)
  }
})

// PowerSync Batch Upload Endpoint (transactional outbox: domain write + events
// commit atomically; relay to RabbitMQ happens after COMMIT, best-effort).
// Tables/columns are allow-listed (see sync.ts); every row is bound to the
// caller's verified facility; audit_logs appends go through the server-owned
// chain (audit/append.ts).
app.post('/api/sync/upload', requireFirebaseIdentity, async (req: Request, res: Response) => {
  const { batch } = req.body
  if (!Array.isArray(batch) || batch.length > 500) {
    res.status(400).json({ error: 'Expected batch array (max 500 items)' })
    return
  }
  const identity = req.identity as NonNullable<typeof req.identity>

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
      const scoped = assertItemScoped(checked.item, identity)
      if (!scoped.ok) {
        await client.query('ROLLBACK')
        res.status(403).json({ error: scoped.error })
        return
      }
      const { op: opType, table, data, id } = checked.item
      const d = (data ?? {}) as Record<string, unknown>

      if (opType === 'PUT' && isServerAppendTable(table)) {
        // Server-owned chain append (audit_logs). Events emitted after COMMIT.
        await appendAuditServer(client as unknown as AuditClient, auditItemToAppend(checked.item))
      } else if (opType === 'PUT') {
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
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Batch upload error:', err)
    res.status(500).json({ error: 'Internal server error' })
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
  } catch (err) {
    fail(res, err)
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
  } catch (err) {
    await client.query('ROLLBACK')
    fail(res, err)
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
// autocomplete it via PowerSync. Uses its own WMS_API_KEY (never in the browser).
app.post('/api/wms/manifest', requireWmsKey, async (req: Request, res: Response) => {
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
  } catch (err) {
    fail(res, err)
  }
})

// WMS confirm (Phase 5 billing loop): ERP acknowledges the gate ticket.
// Idempotent — replays of the same confirmation are no-ops.
const confirmSchema = z.object({
  queueEntryId: z.string().min(1),
  erpReference: z.string().min(1),
})

app.post('/api/wms/confirm', requireWmsKey, async (req: Request, res: Response) => {
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
  } catch (err) {
    fail(res, err)
  }
})

// Push subscriptions ($0 leg): tablets register their FCM token. Identity comes
// from the verified token — the body can't impersonate another user/facility.
const pushSubSchema = z.object({
  facilityId: z.string().min(1).max(64),
  role: z.string().min(1).max(32),
  fcmToken: z.string().min(10).max(512),
})

app.post('/api/push/subscribe', requireFirebaseIdentity, async (req: Request, res: Response) => {
  const identity = req.identity as NonNullable<typeof req.identity>
  const parsed = pushSubSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Expected { facilityId, role, fcmToken }' })
    return
  }
  if (!identityHasFacility(identity, parsed.data.facilityId)) {
    res.status(403).json({ error: 'Forbidden: facility not in your claims' })
    return
  }
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, facility_id, role, fcm_token)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, fcm_token) DO UPDATE SET role = $3, facility_id = $2`,
      [identity.uid, parsed.data.facilityId, identity.role ?? parsed.data.role, parsed.data.fcmToken],
    )
    res.json({ success: true })
  } catch (err) {
    fail(res, err)
  }
})

app.post('/api/push/unsubscribe', requireFirebaseIdentity, async (req: Request, res: Response) => {
  const identity = req.identity as NonNullable<typeof req.identity>
  const parsed = z.object({ fcmToken: z.string().min(10).max(512) }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Expected { fcmToken }' })
    return
  }
  try {
    await pool.query(`DELETE FROM push_subscriptions WHERE user_id = $1 AND fcm_token = $2`, [
      identity.uid,
      parsed.data.fcmToken,
    ])
    res.json({ success: true })
  } catch (err) {
    fail(res, err)
  }
})

// Phase 6 control tower: dwell heatmap, surge status, ROI. Read-only,
// facility-scoped to the caller's verified claims.
function facilityQuery(req: Request): string | null {
  const f = req.query.facilityId
  return typeof f === 'string' && f.length > 0 && f.length <= 64 ? f : null
}

function requireScopedFacility(req: Request, res: Response): string | null {
  const facilityId = facilityQuery(req)
  if (!facilityId) {
    res.status(400).json({ error: 'facilityId query param required' })
    return null
  }
  if (!identityHasFacility(req.identity, facilityId)) {
    res.status(403).json({ error: 'Forbidden: facility not in your claims' })
    return null
  }
  return facilityId
}

app.get('/api/analytics/heatmap', requireFirebaseIdentity, async (req: Request, res: Response) => {
  const facilityId = requireScopedFacility(req, res)
  if (!facilityId) return
  try {
    res.json({ success: true, buckets: await getDwellHeatmap(facilityId, Number(req.query.days ?? 14)) })
  } catch (err) {
    fail(res, err)
  }
})

app.get('/api/analytics/surge', requireFirebaseIdentity, async (req: Request, res: Response) => {
  const facilityId = requireScopedFacility(req, res)
  if (!facilityId) return
  try {
    res.json({ success: true, ...(await getSurgeStatus(facilityId)) })
  } catch (err) {
    fail(res, err)
  }
})

app.get('/api/analytics/roi', requireFirebaseIdentity, async (req: Request, res: Response) => {
  const facilityId = requireScopedFacility(req, res)
  if (!facilityId) return
  try {
    res.json({ success: true, ...(await getRoi(facilityId, Number(req.query.days ?? 30))) })
  } catch (err) {
    fail(res, err)
  }
})

// Ops status — now behind the shared key too (L1).
app.get('/api/events/status', requireApiKey, async (_req: Request, res: Response) => {
  try {
    const pending = await countPendingOutbox(async (text, params) => ({ rows: (await pool.query(text, params)).rows }))
    const publisher = await getPublisher()
    res.json({
      broker: publisher.connected ? 'connected' : 'disabled (RABBITMQ_URL unset — outbox mode)',
      outboxPending: pending,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    fail(res, err)
  }
})

app.listen(port, () => {
  console.log(`[PowerSync Backend] Running on http://localhost:${port}`)
})