import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import JourneyPanel from './JourneyPanel'
import { apiFetch } from '../lib/api'
import { useSession } from '../store/session'
import type { RouteTrip, RouteWorkspace } from '../lib/routes'

vi.mock('../lib/api', () => ({ apiFetch:vi.fn(), facilityId:'1', ApiError:class extends Error {} }))
const trip = {id:3,context:null} as unknown as RouteTrip
const workspace = {can_save:true,visits:[]} as unknown as RouteWorkspace
const journey = {id:1,visit_id:2,stage:'YARD_RELEASE_AUTHORISED',yard_status:'RELEASED',dock:'Dock 1',events:[
  {id:'release:1',kind:'YARD_RELEASE_AUTHORISED',at:'2026-10-07T08:00:00Z',actor_id:5},
]}
beforeEach(() => { cleanup(); vi.clearAllMocks(); useSession.getState().signInReal('ops','OPERATIONS_SUPERVISOR','Operations') })

it('records departure separately and advances the shared timeline to arrival', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({journey}).mockResolvedValueOnce({journey:{...journey,stage:'DEPARTED'}})
  const changed=vi.fn()
  render(<JourneyPanel trip={trip} workspace={workspace} onChange={changed}/>)
  expect(await screen.findByText('YARD RELEASE AUTHORISED', {selector:'strong'})).toBeVisible()
  fireEvent.change(screen.getByLabelText('Observation reason'),{target:{value:'Gate departure observed'}})
  fireEvent.click(screen.getByRole('button',{name:'Record departed'}))
  await waitFor(()=>expect(apiFetch).toHaveBeenCalledTimes(2))
  expect(vi.mocked(apiFetch).mock.calls[1]).toEqual(['/trips/3/journey/events/',expect.objectContaining({method:'POST',body:expect.objectContaining({kind:'DEPARTED',reason:'Gate departure observed',details:{}})})])
  expect(await screen.findByRole('button',{name:'Record destination arrived'})).toBeVisible()
  expect(changed).toHaveBeenCalledOnce()
})

it('keeps admin observation controls hidden until a working role is selected', async () => {
  useSession.getState().signInReal('admin','ADMIN','Admin')
  vi.mocked(apiFetch).mockResolvedValue({journey})
  render(<JourneyPanel trip={trip} workspace={workspace} onChange={()=>{}}/>)
  await screen.findByText('YARD RELEASE AUTHORISED', {selector:'strong'})
  expect(screen.queryByRole('button',{name:'Record departed'})).not.toBeInTheDocument()
})

it('requires receiver and document evidence before recording delivery', async () => {
  vi.mocked(apiFetch).mockResolvedValue({journey:{...journey,stage:'DESTINATION_ARRIVED'}})
  render(<JourneyPanel trip={trip} workspace={workspace} onChange={()=>{}}/>)
  const button=await screen.findByRole('button',{name:'Record delivery accepted'})
  fireEvent.change(screen.getByLabelText('Observation reason'),{target:{value:'Receiver confirmed'}})
  expect(button).toBeDisabled()
  expect(screen.getByText(/File stays on this device/)).toBeVisible()
  expect(screen.getByText(/connectors are not configured/)).toBeVisible()
})
