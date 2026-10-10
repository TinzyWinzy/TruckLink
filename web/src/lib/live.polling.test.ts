import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const stops: Array<() => void> = []
const board = { queue: [{ id: 1, reg_number: 'SHARED-1', status: 'QUEUED' }],
  docks: [{ id: 2, name: 'Dock 2' }], alerts: [{ id: 3, severity: 'CRITICAL', acknowledged: false }] }
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubEnv('VITE_API_URL', 'http://api.test')
  localStorage.clear()
  sessionStorage.clear()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  fetchMock = vi.fn(async () => new Response(JSON.stringify(board), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  stops.splice(0).forEach(stop => stop())
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function setup() {
  const live = await import('./live')
  const api = await import('./api')
  const { useSession } = await import('../store/session')
  useSession.getState().signInReal('actor-1', 'OPERATIONS_SUPERVISOR', 'Operator')
  useSession.getState().setWorkspace({ organisation: { id: 1, name: 'Tenant', slug: 'tenant' },
    facilities: [{ id: 10, name: 'Yard', slug: 'yard' }], selectedFacility: '10' })
  api.selectFacility('10')
  api.setToken('synthetic')
  return { live, api, useSession }
}

it('shares one board request per tick across alerts, queue and docks; keeps remaining subscribers alive', async () => {
  const { live } = await setup()
  const queue = vi.fn(), docks = vi.fn(), alerts = vi.fn()
  for (const [feed, receive] of [['queue', queue], ['docks', docks], ['alerts', alerts]] as const)
    stops.push(live.subscribe(feed, receive)!)
  await vi.advanceTimersByTimeAsync(0)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.test/api/yard/board/?facility=10&scope=active&compact=1')
  expect(queue).toHaveBeenCalledWith([expect.objectContaining({ licensePlate: 'SHARED-1' })])
  expect(docks).toHaveBeenCalledWith([expect.objectContaining({ name: 'Dock 2' })])
  expect(alerts).toHaveBeenCalledWith([expect.objectContaining({ status: 'ACTIVE' })])
  stops[0]!()
  await vi.advanceTimersByTimeAsync(5000)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(queue).toHaveBeenCalledTimes(1)
  expect(docks).toHaveBeenCalledTimes(2)
  stops.splice(0).forEach(stop => stop())
  await vi.advanceTimersByTimeAsync(5000)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('reuses a fresh snapshot for a late subscriber and pauses hidden-tab polling', async () => {
  const { live } = await setup()
  stops.push(live.subscribe('queue', vi.fn())!)
  await vi.advanceTimersByTimeAsync(0)
  const alerts = vi.fn()
  stops.push(live.subscribe('alerts', alerts)!)
  expect(alerts).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  await vi.advanceTimersByTimeAsync(10000)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(0)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it.each(['actor', 'role', 'yard', 'session'] as const)('discards an in-flight response after changing %s scope', async changed => {
  const { live, api, useSession } = await setup()
  let finish!: (response: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
  const old = vi.fn()
  stops.push(live.subscribe('queue', old)!)
  await vi.advanceTimersByTimeAsync(0)
  if (changed === 'actor') useSession.getState().signInReal('actor-2', 'OPERATIONS_SUPERVISOR', 'Other')
  if (changed === 'role') useSession.getState().signInReal('actor-1', 'DISPATCH_SUPERVISOR', 'Operator')
  if (changed === 'yard') api.selectFacility('11')
  if (changed === 'session') api.setRefreshToken('synthetic-new-session')
  const fresh = vi.fn()
  stops.push(live.subscribe('queue', fresh)!)
  await vi.advanceTimersByTimeAsync(0)
  finish(new Response(JSON.stringify(board), { status: 200 }))
  await vi.advanceTimersByTimeAsync(0)
  expect(old).not.toHaveBeenCalled()
  expect(fresh).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('does not overlap slow requests, reports failures to all subscribers, and recovers', async () => {
  const { live } = await setup()
  let finish!: (response: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
  const error1 = vi.fn(), error2 = vi.fn()
  stops.push(live.subscribe('queue', vi.fn(), 100, error1)!)
  stops.push(live.subscribe('alerts', vi.fn(), 100, error2)!)
  await vi.advanceTimersByTimeAsync(5000)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  finish(new Response('{}', { status: 503 }))
  await vi.advanceTimersByTimeAsync(0)
  expect(error1).toHaveBeenCalledWith(expect.stringContaining('unavailable'))
  expect(error2).toHaveBeenCalledWith(expect.stringContaining('unavailable'))
  await vi.advanceTimersByTimeAsync(5000)
  expect(error1).toHaveBeenLastCalledWith(null)
  expect(error2).toHaveBeenLastCalledWith(null)
})

it('stops after sign-out without notifying the old actor', async () => {
  const { live, api, useSession } = await setup()
  const receive = vi.fn()
  stops.push(live.subscribe('queue', receive)!)
  api.clearToken()
  useSession.getState().signOut()
  await vi.advanceTimersByTimeAsync(10000)
  expect(fetchMock).not.toHaveBeenCalled()
  expect(receive).not.toHaveBeenCalled()
  expect(live.subscribe('queue', receive)).toBeNull()
})
