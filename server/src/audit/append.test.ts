import { describe, expect, it, beforeEach } from 'vitest'
import { appendAuditServer, hashAuditEntry, requireAuditSalt, type AuditAppendInput, type PgClient } from './append.js'

class FakePgClient implements PgClient {
  public meta = new Map<string, { current_hash: string; seq: number }>()
  public rows = new Map<string, { previous_hash: string; hash: string }>()

  async query(text: string, params?: unknown[]): Promise<{ rowCount: number; rows: Array<Record<string, unknown>> }> {
    if (text.includes('INSERT INTO audit_meta')) {
      const facilityId = String(params?.[0])
      if (!this.meta.has(facilityId)) this.meta.set(facilityId, { current_hash: 'GENESIS', seq: 0 })
      return { rowCount: 1, rows: [] }
    }
    if (text.includes('SELECT current_hash, seq FROM audit_meta')) {
      const facilityId = String(params?.[0])
      const m = this.meta.get(facilityId) ?? { current_hash: 'GENESIS', seq: 0 }
      return { rowCount: 1, rows: [{ current_hash: m.current_hash, seq: m.seq }] }
    }
    if (text.includes('INSERT INTO audit_logs')) {
      const id = String(params?.[0])
      if (this.rows.has(id)) return { rowCount: 0, rows: [] }
      this.rows.set(id, { previous_hash: String(params?.[6]), hash: String(params?.[7]) })
      const facilityId = String(params?.[1])
      const m = this.meta.get(facilityId) ?? { current_hash: 'GENESIS', seq: 0 }
      this.meta.set(facilityId, { current_hash: String(params?.[7]), seq: m.seq + 1 })
      return { rowCount: 1, rows: [] }
    }
    if (text.includes('UPDATE audit_meta')) return { rowCount: 1, rows: [] }
    return { rowCount: 0, rows: [] }
  }
}

function entry(over: Partial<AuditAppendInput> = {}): AuditAppendInput {
  return {
    id: 'a-1',
    facilityId: 'f1',
    action: 'GATE_RELEASE',
    payload: '{"reg":"AB12"}',
    actorId: 'u-1',
    timestamp: '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('appendAuditServer (H3/M3 server-owned chain)', () => {
  beforeEach(() => {
    delete process.env.AUDIT_SALT
  })

  it('fails closed when AUDIT_SALT is unset', async () => {
    await expect(appendAuditServer(new FakePgClient(), entry())).rejects.toThrow(/AUDIT_SALT/)
    expect(requireAuditSalt).toThrow(/AUDIT_SALT/)
  })

  it('chains entries and advances the meta counter', async () => {
    const client = new FakePgClient()
    process.env.AUDIT_SALT = 'unit-test-salt'
    await appendAuditServer(client, entry())
    const second = entry({ id: 'a-2', payload: '{"reg":"AB42"}' })
    await appendAuditServer(client, second)
    const a1 = client.rows.get('a-1')!
    const a2 = client.rows.get('a-2')!
    expect(a1.previous_hash).toBe('GENESIS')
    expect(a2.previous_hash).toBe(a1.hash)
    expect(a2.hash).toBe(hashAuditEntry(a1.hash, '{"reg":"AB42"}', 'unit-test-salt'))
    expect(client.meta.get('f1')).toEqual({ current_hash: a2.hash, seq: 2 })
    delete process.env.AUDIT_SALT
  })

  it('replay of the same id is a no-op that does not advance the chain', async () => {
    const client = new FakePgClient()
    process.env.AUDIT_SALT = 'unit-test-salt'
    await appendAuditServer(client, entry())
    const before = client.meta.get('f1')
    await appendAuditServer(client, entry())
    expect(client.meta.get('f1')).toEqual(before)
    delete process.env.AUDIT_SALT
  })
})