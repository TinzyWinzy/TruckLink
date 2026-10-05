// Transactional outbox (Phase 4). Events are inserted inside the same Postgres
// transaction as the domain write, then relayed to RabbitMQ after COMMIT.
// If the broker is down, rows stay pending and a worker relay drains them later.

export interface OutboxEvent {
  id: string
  exchange: string
  routingKey: string
  payload: Record<string, unknown>
}

interface PgClient {
  query(text: string, params?: unknown[]): Promise<unknown>
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Insert inside the caller's transaction — never opens its own. */
export async function insertOutbox(
  client: PgClient,
  exchange: string,
  routingKey: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const id = newId('evt')
  await client.query(
    `INSERT INTO outbox_events (id, exchange, routing_key, payload) VALUES ($1, $2, $3, $4)`,
    [id, exchange, routingKey, JSON.stringify(payload)],
  )
  return id
}

export async function listPendingOutbox(
  query: (text: string, params?: unknown[]) => Promise<{ rows: OutboxEvent[] }>,
  limit = 100,
): Promise<OutboxEvent[]> {
  const res = await query(
    `SELECT id, exchange, routing_key AS "routingKey", payload FROM outbox_events
     WHERE dispatched_at IS NULL ORDER BY created_at ASC LIMIT $1`,
    [limit],
  )
  return res.rows
}

export async function markOutboxDispatched(
  client: PgClient,
  id: string,
): Promise<void> {
  await client.query(
    `UPDATE outbox_events SET dispatched_at = NOW(), attempts = attempts + 1 WHERE id = $1`,
    [id],
  )
}

export async function countPendingOutbox(
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ count: string }> }>,
): Promise<number> {
  const res = await query(`SELECT COUNT(*)::text AS count FROM outbox_events WHERE dispatched_at IS NULL`)
  return Number(res.rows[0]?.count ?? 0)
}
