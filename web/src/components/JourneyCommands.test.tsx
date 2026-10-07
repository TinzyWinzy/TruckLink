import {beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import JourneyCommands from './JourneyCommands'
import {useSession} from '../store/session'
import {apiFetch} from '../lib/api'
import type {Journey} from '../lib/journey'
vi.mock('../lib/api',()=>({apiFetch:vi.fn()}))
const journey:Journey={id:1,trip_id:2,visit_id:3,stage:'AT_ORIGIN',yard_status:'AT_DOCK',dock:null,integrations:{erp:'NOT_CONFIGURED',tracking:'NOT_CONFIGURED'},external_reference:null,itinerary:['First','Final'],events:[]}
beforeEach(()=>{cleanup();vi.clearAllMocks();useSession.getState().signInReal('5','OPERATIONS_SUPERVISOR','Operations')})
it('saves selected ordered stops with optimistic plan version and consignment quantities',async()=>{
  vi.mocked(apiFetch).mockResolvedValue({journey});const update=vi.fn()
  render(<MemoryRouter><JourneyCommands journey={journey} onUpdate={update}/></MemoryRouter>)
  fireEvent.click(screen.getByText('Configure delivery stops'))
  fireEvent.click(screen.getByLabelText('First'))
  fireEvent.change(screen.getByLabelText('Consignments for First'),{target:{value:'ORDER-1 | 10 | cartons'}})
  fireEvent.change(screen.getByLabelText('Consignments for Final'),{target:{value:'ORDER-2 | 5 | pallets'}})
  fireEvent.change(screen.getByLabelText('Operation reason'),{target:{value:'Confirmed dispatch manifest'}})
  fireEvent.click(screen.getByRole('button',{name:'Save delivery plan'}))
  await waitFor(()=>expect(update).toHaveBeenCalledWith(journey))
  expect(apiFetch).toHaveBeenCalledWith('/trips/2/journey/plan/',expect.objectContaining({method:'POST',body:expect.objectContaining({expected_version:0,stops:[{route_index:0,consignments:[{reference:'ORDER-1',quantity:'10',unit:'cartons'}]},{route_index:1,consignments:[{reference:'ORDER-2',quantity:'5',unit:'pallets'}]}]})}))
})
it('restricts recovery to operators and requires an explicit reason',async()=>{
  const released={...journey,stage:'YARD_RELEASE_AUTHORISED',yard_status:'RELEASED',can_withdraw_release:true}
  vi.mocked(apiFetch).mockResolvedValue({journey})
  const view=render(<MemoryRouter><JourneyCommands journey={released} onUpdate={()=>{}}/></MemoryRouter>)
  expect(screen.getByRole('button',{name:'Withdraw release for reinspection'})).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Operation reason'),{target:{value:'Damaged load restraint'}})
  fireEvent.click(screen.getByRole('button',{name:'Withdraw release for reinspection'}))
  await waitFor(()=>expect(apiFetch).toHaveBeenCalledWith('/trips/2/journey/withdraw-release/',expect.objectContaining({body:expect.objectContaining({reason:'Damaged load restraint'})})))
  view.unmount();useSession.getState().signInReal('6','EXECUTIVE','Executive')
  render(<MemoryRouter><JourneyCommands journey={released} onUpdate={()=>{}}/></MemoryRouter>)
  expect(screen.queryByRole('button',{name:'Withdraw release for reinspection'})).not.toBeInTheDocument()
})
