import { describe, expect, it } from 'vitest'
import { validateBatchItem } from './sync.js'
import { requireApiKey, apiKeyConfigured } from './auth.js'

describe('validateBatchItem (upload allow-list)', () => {
  it('accepts known table + columns', () => {
    const r = validateBatchItem({ op: 'PUT', table: 'queue_entries', id: 'q-1', data: { status: 'QUEUED' } })
    expect(r.ok).toBe(true)
  })

  it('rejects unknown tables (SQL-injection surface)', () => {
    expect(validateBatchItem({ op: 'PUT', table: 'outbox_events', id: 'x', data: {} }).ok).toBe(false)
    expect(validateBatchItem({ op: 'DELETE', table: 'pg_shadow", "--', id: 'x' }).ok).toBe(false)
  })

  it('rejects unknown columns and bad shapes', () => {
    expect(validateBatchItem({ op: 'PUT', table: 'alerts', id: 'a', data: { nope: 1 } }).ok).toBe(false)
    expect(validateBatchItem({ op: 'PUT', table: 'alerts', id: 'a' }).ok).toBe(false)
    expect(validateBatchItem({ op: 'DROP', table: 'alerts', id: 'a' }).ok).toBe(false)
  })
})

describe('requireApiKey', () => {
  const next = () => undefined as never

  it('is open in dev (no key configured) — matches documented posture', () => {
    expect(apiKeyConfigured()).toBe(false)
    let passed = false
    requireApiKey({ headers: {} } as never, {} as never, (() => { passed = true }) as never)
    expect(passed).toBe(true)
    void next
  })

  it('rejects missing/wrong keys when configured', () => {
    process.env.SYNC_API_KEY = 'test-key-16-chars-ok'
    expect(apiKeyConfigured()).toBe(true)
    let status = 0
    const res = { status: (s: number) => { status = s; return { json: () => undefined } } }
    requireApiKey({ headers: {} } as never, res as never, (() => { throw new Error('should not pass') }) as never)
    expect(status).toBe(401)
    let passed = false
    requireApiKey(
      { headers: { 'x-api-key': 'test-key-16-chars-ok' } } as never,
      res as never,
      (() => { passed = true }) as never,
    )
    expect(passed).toBe(true)
    delete process.env.SYNC_API_KEY
  })
})
