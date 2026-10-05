import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// B6 offline outbox integration (SAD §14 release-blocking):
// enqueue -> flushPendingActions -> replayOne -> apiFetch -> idempotent server.
// api.ts captures VITE_API_URL at module load, so each case re-imports the
// whole graph (vi.resetModules + vi.stubEnv) for a deterministic BASE.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function importOutbox(apiUrl: string) {
  vi.resetModules()
  vi.stubEnv('VITE_API_URL', apiUrl)
  const db = await import('./offline/db')
  // IndexedDB outlives the module registry — start each case from empty.
  await db.db.pendingActions.clear()
  const api = await import('./api')
  const live = await import('./live')
  const { useSession } = await import('../store/session')
  useSession.getState().signInReal('user-live', 'DISPATCH_SUPERVISOR', 'Live')
  api.setToken('test-token-1')
  return { db, api, live }
}

describe('offline outbox integration (enqueue → replay → idempotent server)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('replays queue + compliance actions in order with idempotency keys', async () => {
    const { db, live } = await importOutbox('http://api.test')
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { ok: true, queue_entry: { id: 'q1' } }))
      .mockResolvedValueOnce(
        jsonResponse(201, { ok: true, check: { overall_status: 'PASS' } }),
      )

    const queueAction = await db.enqueueOfflineAction('queue.create', {
      licensePlate: 'AEH 4521',
      driverName: 'T. Moyo',
      cargoType: 'Container',
      expectedDestination: 'Beitbridge',
    })
    const complianceAction = await db.enqueueOfflineAction('compliance.submit', {
      queueEntryId: 'q1',
      weights: [6000, 8000, 8000],
      totalWeight: 22000,
      gvmRating: 24000,
      supervisorId: 'user-live',
    })

    const result = await live.flushPendingActions()
    expect(result).toEqual({ done: 2, failed: 0 })
    expect(await db.pendingActionCount()).toBe(0)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [queueCall, complianceCall] = fetchMock.mock.calls as [
      [string, RequestInit],
      [string, RequestInit],
    ]
    expect(queueCall[0]).toBe('http://api.test/api/queue/')
    const queueBody = JSON.parse(String(queueCall[1].body))
    expect(queueBody.idempotency_key).toBe(`q-${queueAction.id}`)
    expect(queueCall[1].headers).toMatchObject({
      Authorization: 'Token test-token-1',
    })

    expect(complianceCall[0]).toBe('http://api.test/api/compliance/')
    const complianceBody = JSON.parse(String(complianceCall[1].body))
    expect(complianceBody.client_key).toBe(complianceAction.id)
    expect(complianceBody.queue_entry).toBe('q1')
  })

  it('treats a server-side replay (200 replayed) as success — action removed once', async () => {
    const { db, live } = await importOutbox('http://api.test')
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ok: true,
        replayed: true,
        check: { id: 'check-1', overall_status: 'FAIL' },
      }),
    )

    await db.enqueueOfflineAction('compliance.submit', {
      queueEntryId: 'q1',
      weights: [9500, 8000, 8000],
      totalWeight: 25500,
      gvmRating: 24000,
      supervisorId: 'user-live',
    })

    const result = await live.flushPendingActions()
    expect(result).toEqual({ done: 1, failed: 0 })
    expect(await db.pendingActionCount()).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the action queued on network failure and counts the retry', async () => {
    const { db, live } = await importOutbox('http://api.test')
    fetchMock.mockRejectedValueOnce(new TypeError('network down'))

    const action = await db.enqueueOfflineAction('queue.create', {
      licensePlate: 'AGX 9033',
      driverName: 'S. Ndlovu',
      cargoType: 'Dry van',
      expectedDestination: 'Forbes',
    })

    const result = await live.flushPendingActions()
    expect(result).toEqual({ done: 0, failed: 1 })

    const pending = await db.listPendingActions()
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe(action.id)
    expect(pending[0].retryCount).toBe(1)
  })

  it('no-ops when the yard backend is not configured (practice mode)', async () => {
    const { db, live } = await importOutbox('')

    await db.enqueueOfflineAction('queue.create', {
      licensePlate: 'AFM 1187',
      driverName: 'K. Sibanda',
      cargoType: 'Tanker',
      expectedDestination: 'Chirundu',
    })

    const result = await live.flushPendingActions()
    expect(result).toEqual({ done: 0, failed: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await db.pendingActionCount()).toBe(1)
  })
})
