import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import {
  __resetOfflineMigration,
  db,
  LocalAppDatabase,
  enqueueOfflineAction,
  listPendingActions,
  pendingActionCount,
  recordActionFailure,
  removePendingAction,
} from './db'

beforeEach(async () => {
  localStorage.clear()
  __resetOfflineMigration()
  await db.pendingActions.clear()
  await db.inspections.clear()
  await db.syncQueue.clear()
})

describe('offline action queue (Dexie/IndexedDB)', () => {
  it('upgrades v2 pending work without losing ownership, failures or capture time', async () => {
    const name = 'isolated-story-outbox-upgrade'
    const old = new Dexie(name)
    old.version(2).stores({ pendingActions: 'id, actionType, timestamp, actorId, facilityId, state',
      inspections: '++id, vehicleReg, status, timestamp, synced', syncQueue: '++id, action, timestamp' })
    const original = { id: 'retained', actionType: 'queue.create', payload: { licensePlate: 'HISTORY' },
      timestamp: 123, actorId: 'original-actor', facilityId: 'original-site', apiBase: 'http://original-api',
      state: 'BLOCKED', retryCount: 5, lastError: 'Needs supervisor review' }
    await old.table('pendingActions').add(original)
    old.close()
    const upgraded = new LocalAppDatabase(name)
    try {
      await upgraded.open()
      expect(await upgraded.pendingActions.get('retained')).toMatchObject({ ...original, sequence: 1 })
    } finally { upgraded.close(); await Dexie.delete(name) }
  })
  it('preserves capture order when equal timestamps have reverse-sorted IDs', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const ids = vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('ffffffff-ffff-4fff-8fff-ffffffffffff')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000000')
    try {
      const first = await enqueueOfflineAction('queue.create', { licensePlate: 'FIRST' })
      const second = await enqueueOfflineAction('compliance.submit', { queueEntryId: 'FIRST' })
      expect((await listPendingActions()).map(action => action.id)).toEqual([first.id, second.id])
      expect(first.timestamp).toBe(second.timestamp)
    } finally { clock.mockRestore(); ids.mockRestore() }
  })
  it('enqueues and lists in chronological order', async () => {
    const a = await enqueueOfflineAction('queue.create', { licensePlate: 'AEH 4521' })
    const b = await enqueueOfflineAction('queue.create', { licensePlate: 'AGX 9033' })
    expect(await pendingActionCount()).toBe(2)
    const ids = (await listPendingActions()).map((x) => x.id)
    expect(ids).toEqual([a.id, b.id])
  })

  it('removes on successful replay', async () => {
    const a = await enqueueOfflineAction('queue.create', { licensePlate: 'AEH 4521' })
    await removePendingAction(a.id)
    expect(await pendingActionCount()).toBe(0)
  })

  it('retains actions for review after 5 failed retries', async () => {
    const a = await enqueueOfflineAction('queue.create', { licensePlate: 'AEH 4521' })
    for (let i = 0; i < 4; i++) {
      expect(await recordActionFailure(a.id, 'network down')).not.toBeNull()
    }
    expect(await recordActionFailure(a.id, 'network down')).toMatchObject({ state: 'BLOCKED', retryCount: 5 })
    expect(await pendingActionCount()).toBe(1)
  })

  it('survives 100+ actions and stays reload-safe (ordered)', async () => {
    for (let i = 0; i < 120; i++) {
      await enqueueOfflineAction('queue.create', { licensePlate: `AEH ${1000 + i}` })
    }
    const all = await listPendingActions()
    expect(all).toHaveLength(120)
    const ts = all.map((a) => a.timestamp)
    expect([...ts].sort((x, y) => x - y)).toEqual(ts)
  })

  it('migrates legacy localStorage queue once', async () => {
    const legacy = [
      { id: 'legacy-1', actionType: 'queue.create', payload: { licensePlate: 'AFM 1187' }, timestamp: 1, retryCount: 0 },
    ]
    localStorage.setItem('radbit_bak_pendingActions_v1', JSON.stringify(legacy))
    const all = await listPendingActions()
    expect(all.map((a) => a.id)).toContain('legacy-1')
    expect(localStorage.getItem('radbit_bak_pendingActions_v1')).toBeNull()
  })
})
