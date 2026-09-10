import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetOfflineMigration,
  db,
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

  it('drops actions after 5 failed retries (Spec §8 backoff cap)', async () => {
    const a = await enqueueOfflineAction('queue.create', { licensePlate: 'AEH 4521' })
    for (let i = 0; i < 4; i++) {
      expect(await recordActionFailure(a.id, 'network down')).not.toBeNull()
    }
    expect(await recordActionFailure(a.id, 'network down')).toBeNull()
    expect(await pendingActionCount()).toBe(0)
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
