import { createHash } from 'node:crypto'

// Pure audit-chain helpers (Spec §7.4). No Firebase imports so they run anywhere.

export function hashAuditEntry(previousHash: string, payload: string, facilitySalt: string): string {
  return createHash('sha256').update(`${previousHash}${payload}${facilitySalt}`).digest('hex')
}

export interface ChainedEntry {
  payload: string
  previousHash: string
  currentHash: string
}

export function chainEntries(payloads: string[], facilitySalt: string): ChainedEntry[] {
  let previousHash = 'GENESIS'
  return payloads.map((payload) => {
    const currentHash = hashAuditEntry(previousHash, payload, facilitySalt)
    const entry: ChainedEntry = { payload, previousHash, currentHash }
    previousHash = currentHash
    return entry
  })
}

/** Recompute the chain; returns index of first broken link, or -1 if intact. */
export function verifyChain(entries: ChainedEntry[], facilitySalt: string): number {
  let previousHash = 'GENESIS'
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.previousHash !== previousHash) return i
    if (e.currentHash !== hashAuditEntry(e.previousHash, e.payload, facilitySalt)) return i
    previousHash = e.currentHash
  }
  return -1
}
