// Publisher abstraction (Phase 4). amqplib is only imported when a broker is
// actually configured, so `npm run dev` / tests work with zero infra.

import { ALLOWED_PUBLISH_KEYS } from './topology.js'

export interface Publisher {
  readonly connected: boolean
  publish(exchange: string, routingKey: string, payload: Record<string, unknown>): Promise<void>
  close(): Promise<void>
}

class NoOpPublisher implements Publisher {
  readonly connected = false
  async publish(): Promise<void> {
    // Intentionally silent: the outbox row is the durable record; relay later.
  }
  async close(): Promise<void> {}
}

interface AmqpChannel {
  publish(exchange: string, routingKey: string, content: Buffer, opts?: Record<string, unknown>): boolean
}

class AmqpPublisher implements Publisher {
  readonly connected = true
  constructor(
    private readonly channel: AmqpChannel,
    private readonly closeFn: () => Promise<void>,
  ) {}
  async publish(exchange: string, routingKey: string, payload: Record<string, unknown>): Promise<void> {
    this.channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(payload)), {
      persistent: true,
      contentType: 'application/json',
    })
  }
  async close(): Promise<void> {
    await this.closeFn()
  }
}

let cached: Publisher | null = null

export function resetPublisherCache(): void {
  cached = null
}

/** Singleton: NoOp when RABBITMQ_URL is unset, AMQP otherwise. */
export async function getPublisher(): Promise<Publisher> {
  if (cached) return cached
  const url = process.env.RABBITMQ_URL
  if (!url) {
    cached = new NoOpPublisher()
    return cached
  }
  // Lazy import keeps amqplib optional for broker-less dev/test.
  const amqp = await import('amqplib')
  const conn = await amqp.connect(url)
  const ch = await conn.createChannel()
  cached = new AmqpPublisher(ch as unknown as AmqpChannel, async () => {
    await ch.close()
    await conn.close()
  })
  return cached
}

/** Guard for the direct-publish endpoint — only known routing keys allowed. */
export function isAllowedPublishKey(routingKey: string): boolean {
  return ALLOWED_PUBLISH_KEYS.has(routingKey)
}
