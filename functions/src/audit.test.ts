import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chainEntries, hashAuditEntry, verifyChain } from './audit.js'

describe('hashAuditEntry', () => {
  it('is deterministic and salt-sensitive', () => {
    const a = hashAuditEntry('GENESIS', '{"action":"CREATE"}', 'salt-1')
    assert.equal(a, hashAuditEntry('GENESIS', '{"action":"CREATE"}', 'salt-1'))
    assert.notEqual(a, hashAuditEntry('GENESIS', '{"action":"CREATE"}', 'salt-2'))
    assert.equal(a.length, 64) // SHA-256 hex
  })
})

describe('chain tamper detection', () => {
  it('verifies an intact chain', () => {
    const entries = chainEntries(['{"a":1}', '{"b":2}', '{"c":3}'], 'facility-salt')
    assert.equal(verifyChain(entries, 'facility-salt'), -1)
  })

  it('flags a modified payload', () => {
    const entries = chainEntries(['{"a":1}', '{"b":2}'], 'facility-salt')
    entries[1] = { ...entries[1], payload: '{"b":999}' }
    assert.equal(verifyChain(entries, 'facility-salt'), 1)
  })

  it('flags a removed link', () => {
    const entries = chainEntries(['{"a":1}', '{"b":2}', '{"c":3}'], 'facility-salt')
    entries.splice(1, 1)
    assert.equal(verifyChain(entries, 'facility-salt'), 1)
  })
})
