import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); localStorage.clear() })
async function setup() {
  vi.resetModules()
  vi.stubEnv('VITE_API_URL', 'https://api.test')
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const api = await import('./api')
  api.setToken('expired')
  api.setRefreshToken('renewable')
  return { api, fetcher }
}
const response = (status: number, data: unknown = {}) => new Response(JSON.stringify(data), { status })

it('fresh login never sends an old access token', async () => {
  const { api, fetcher } = await setup()
  fetcher.mockResolvedValue(response(200))
  await api.apiFetch('/auth/pin/', { method:'POST', body:{ staff_id:'synthetic', pin:'synthetic' } })
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBeUndefined()
})

it('CSV downloads renew expired sessions and preserve the response text',async()=>{
  const {api,fetcher}=await setup()
  fetcher.mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200,{token:'renewed'})).mockResolvedValueOnce(new Response('id,action\n1,TEST\n',{status:200,headers:{'Content-Type':'text/csv'}}))
  expect(await api.apiFetch('/audit/export.csv?facility=7',{responseType:'text'})).toBe('id,action\n1,TEST\n')
  expect(fetcher.mock.calls.at(-1)?.[1].headers.Authorization).toBe('Token renewed')
})

it('concurrent expired requests share refresh and retry with the new access token', async () => {
  const { api, fetcher } = await setup()
  fetcher.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith('/auth/refresh/')) return response(200, { token:'renewed' })
    return response((init.headers as Record<string,string>).Authorization === 'Token renewed' ? 200 : 401)
  })
  await Promise.all([api.apiFetch('/auth/me/'), api.apiFetch('/auth/me/')])
  expect(fetcher.mock.calls.filter(c => c[0].endsWith('/auth/refresh/'))).toHaveLength(1)
  expect(api.getToken()).toBe('renewed')
})

it('temporary renewal failure retains the saved session, definitive rejection clears it', async () => {
  const { api, fetcher } = await setup()
  fetcher.mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(503))
  await expect(api.apiFetch('/auth/me/')).rejects.toMatchObject({ status:503 })
  expect(api.hasSession()).toBe(true)
  fetcher.mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(401))
  await expect(api.apiFetch('/auth/me/')).rejects.toMatchObject({ status:401 })
  expect(api.hasSession()).toBe(false)
})

it('a delayed refresh cannot restore credentials after local sign out', async () => {
  const { api, fetcher } = await setup()
  let finish!: (r: Response) => void
  fetcher.mockResolvedValueOnce(response(401)).mockImplementationOnce(() => new Promise<Response>(r => { finish = r }))
  const pending = api.apiFetch('/auth/me/')
  await vi.waitFor(() => expect(finish).toBeDefined())
  api.clearToken()
  finish(response(200, {token:'obsolete'}))
  await expect(pending).rejects.toMatchObject({status:409})
  expect(api.hasSession()).toBe(false)
})
