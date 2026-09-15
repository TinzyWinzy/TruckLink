import { describe, expect, it } from 'vitest'
import { assertItemScoped, isServerAppendTable, validateBatchItem } from './sync.js'
import { requireApiKey, requireWmsKey, apiKeyConfigured, wmsKeyConfigured } from './auth.js'

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

describe('privileged-column pruning (H2)', () => {
  it('clients can no longer write users.role, users.facility_id, billed, erp_reference', () => {
    for (const bad of [
      { op: 'PUT', table: 'users', id: 'u-1', data: { role: 'ADMIN' } },
      { op: 'PUT', table: 'users', id: 'u-1', data: { facility_id: 'other-facility' } },
      { op: 'PUT', table: 'queue_entries', id: 'q-1', data: { billed: true } },
      { op: 'PUT', table: 'queue_entries', id: 'q-1', data: { erp_reference: 'INV-1' } },
    ]) {
      expect(validateBatchItem(bad).ok).toBe(false)
    }
  })

  it('lets clients write only the auditable facts on audit_logs', () => {
    const ok = validateBatchItem({
      op: 'PUT', table: 'audit_logs', id: 'a-1',
      data: { facility_id: 'f1', action: 'GATE_RELEASE', payload: '{}', actor_id: 'u-1', timestamp: '2026-01-01T00:00:00Z' },
    })
    expect(ok.ok).toBe(true)
    expect(
      validateBatchItem({ op: 'PUT', table: 'audit_logs', id: 'a-1', data: { hash: 'forge-me' } }).ok,
    ).toBe(false)
    expect(isServerAppendTable('audit_logs')).toBe(true)
  })
})

describe('assertItemScoped (facility binding)', () => {
  const admin = { uid: 'u-1', role: 'ADMIN', facilities: ['facility-a'] }

  it('accepts rows inside the caller facility', () => {
    const item = { op: 'PUT' as const, table: 'queue_entries', id: 'q-1', data: { facility_id: 'facility-a', status: 'QUEUED' } }
    const scoped = assertItemScoped(item, admin)
    expect(scoped.ok).toBe(true)
  })

  it('rejects rows for facilities outside the claims', () => {
    const item = { op: 'PUT' as const, table: 'queue_entries', id: 'q-2', data: { facility_id: 'facility-b', status: 'QUEUED' } }
    const scoped = assertItemScoped(item, admin)
    expect(scoped.ok).toBe(false)
  })

  it('rejects audit rows whose actor_id is not the authenticated user', () => {
    const item = { op: 'PUT' as const, table: 'audit_logs', id: 'a-1', data: { facility_id: 'facility-a', action: 'X', actor_id: 'someone-else' } }
    const scoped = assertItemScoped(item, admin)
    expect(scoped.ok).toBe(false)
  })

  it('rejects PATCH/DELETE on audit_logs (write-once, server-chained)', () => {
    const patch = { op: 'PATCH' as const, table: 'audit_logs', id: 'a-1', data: { facility_id: 'facility-a', action: 'REWRITE' } }
    const del = { op: 'DELETE' as const, table: 'audit_logs', id: 'a-1' }
    expect(assertItemScoped(patch, admin).ok).toBe(false)
    expect(assertItemScoped(del, admin).ok).toBe(false)
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

describe('requireWmsKey (separate ERP credential, H1)', () => {
  const next = () => undefined as never

  it('is open in dev (no key configured)', () => {
    expect(wmsKeyConfigured()).toBe(false)
    let passed = false
    requireWmsKey({ headers: {} } as never, {} as never, (() => { passed = true }) as never)
    expect(passed).toBe(true)
    void next
  })

  it('rejects a valid SYNC_API_KEY on WMS endpoints (keys are not interchangeable)', () => {
    process.env.SYNC_API_KEY = 'sync-key-16-chars-ok'
    process.env.WMS_API_KEY = 'wms-key-16-chars-ok??'
    let status = 0
    const res = { status: (s: number) => { status = s; return { json: () => undefined } } }
    requireWmsKey({ headers: { 'x-api-key': 'sync-key-16-chars-ok' } } as never, res as never, next as never)
    expect(status).toBe(401)
    let passed = false
    requireWmsKey(
      { headers: { 'x-api-key': 'wms-key-16-chars-ok??' } } as never,
      res as never,
      (() => { passed = true }) as never,
    )
    expect(passed).toBe(true)
    delete process.env.SYNC_API_KEY
    delete process.env.WMS_API_KEY
  })
})
