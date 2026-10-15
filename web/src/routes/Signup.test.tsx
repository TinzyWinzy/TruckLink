import { beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Signup from './Signup'

const apiFetch = vi.hoisted(() => vi.fn())
const liveFlag = vi.hoisted(() => ({ live: true }))
const setToken = vi.hoisted(() => vi.fn())
const setRefreshToken = vi.hoisted(() => vi.fn())
const restoreSessionLive = vi.hoisted(() => vi.fn())
const signInReal = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())

vi.mock('../lib/api', () => ({ apiFetch, isLive: () => liveFlag.live, setToken, setRefreshToken }))
vi.mock('../lib/live', () => ({ restoreSessionLive }))
vi.mock('../store/session', () => ({
  useSession: Object.assign(() => ({}), { getState: () => ({ signInReal }) }),
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigate }
})

beforeEach(() => {
  cleanup()
  liveFlag.live = true
  apiFetch.mockReset()
  setToken.mockReset()
  setRefreshToken.mockReset()
  restoreSessionLive.mockReset()
  signInReal.mockReset()
  navigate.mockReset()
})

function fillAndSubmit() {
  fireEvent.change(screen.getByRole('textbox', { name: /Company name/ }), { target: { value: 'Mhofu Logistics' } })
  fireEvent.change(screen.getByLabelText(/Your email/), { target: { value: 'ops@mhofu.example' } })
  fireEvent.change(screen.getByLabelText(/Admin username/), { target: { value: 'mhofu-admin' } })
  fireEvent.change(screen.getByLabelText(/Admin password/), { target: { value: 'yard-pass-1' } })
  return fireEvent.click(screen.getByRole('button', { name: /Create yard/ }))
}

it('creates a demo yard, signs the admin in and continues to onboarding', async () => {
  apiFetch.mockResolvedValue({ token: 't1', refresh_token: 'r1' })
  restoreSessionLive.mockResolvedValue({ uid: '7', role: 'ADMIN', displayName: 'mhofu-admin', baseRole: 'ADMIN' })
  render(<MemoryRouter><Signup /></MemoryRouter>)
  await act(async () => { fillAndSubmit() })
  expect(apiFetch).toHaveBeenCalledWith('/tenancy/signup/', {
    method: 'POST',
    body: {
      organisation_name: 'Mhofu Logistics', facility_name: 'Main Yard', facility_mode: 'DEMO',
      facility_timezone: 'Africa/Harare', username: 'mhofu-admin', password: 'yard-pass-1', email: 'ops@mhofu.example',
    },
  })
  expect(setToken).toHaveBeenCalledWith('t1')
  expect(signInReal).toHaveBeenCalledWith('7', 'ADMIN', 'mhofu-admin', 'ADMIN')
  expect(navigate).toHaveBeenCalledWith('/onboarding')
})

it('sends OPERATIONS mode when the demo checkbox is unchecked', async () => {
  apiFetch.mockResolvedValue({ token: 't2' })
  restoreSessionLive.mockResolvedValue({ uid: '8', role: 'ADMIN', displayName: 'x', baseRole: 'ADMIN' })
  render(<MemoryRouter><Signup /></MemoryRouter>)
  fireEvent.click(screen.getByRole('checkbox'))
  await act(async () => { fillAndSubmit() })
  expect(apiFetch.mock.calls[0][1].body.facility_mode).toBe('OPERATIONS')
})

it('prefills the invited email and includes the invite token', async () => {
  apiFetch.mockImplementation((path: string) => path.startsWith('/tenancy/signup-invites/')
    ? Promise.resolve({ email: 'cfo@invited.example' })
    : Promise.resolve({ token: 't3' }))
  restoreSessionLive.mockResolvedValue({ uid: '9', role: 'ADMIN', displayName: 'y', baseRole: 'ADMIN' })
  render(<MemoryRouter initialEntries={['/signup?invite=signed-token']}><Signup /></MemoryRouter>)
  await screen.findByText(/Invited email pre-filled/)
  fireEvent.change(screen.getByRole('textbox', { name: /Company name/ }), { target: { value: 'Invited Co' } })
  fireEvent.change(screen.getByLabelText(/Admin username/), { target: { value: 'inv-admin' } })
  fireEvent.change(screen.getByLabelText(/Admin password/), { target: { value: 'inv-pass-1' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create yard/ })) })
  expect(apiFetch.mock.calls[1][1].body.invite).toBe('signed-token')
  expect(apiFetch.mock.calls[1][1].body.email).toBe('cfo@invited.example')
})

it('reports an invalid invite without blocking manual signup', async () => {
  apiFetch.mockRejectedValue(new Error('link expired or invalid; request a new signup link'))
  render(<MemoryRouter initialEntries={['/signup?invite=bad-token']}><Signup /></MemoryRouter>)
  await screen.findByText(/expired or is invalid/)
  expect(screen.getByRole('button', { name: /Create yard/ })).toBeEnabled()
})

it('shows the not-connected state in practice mode', () => {
  liveFlag.live = false
  render(<MemoryRouter><Signup /></MemoryRouter>)
  expect(screen.getByText(/Yard system not connected/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Create yard/ })).not.toBeInTheDocument()
})
