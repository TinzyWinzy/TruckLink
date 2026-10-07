import {beforeEach,it,expect,vi} from 'vitest'
import {render,screen,cleanup,fireEvent} from '@testing-library/react'
import AuditLog from './AuditLog'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../lib/api',()=>({facilityId:'7',apiFetch:api}))
vi.mock('../lib/liveGate',()=>({useLive:()=>true}))
beforeEach(()=>{cleanup();api.mockReset()})
it('keeps loading and failure distinct from empty, then retries',async()=>{
  api.mockReturnValueOnce(new Promise(()=>{}))
  render(<AuditLog/>);expect(screen.getByText('Loading audit records…')).toBeVisible();expect(screen.queryByText('No entries yet')).not.toBeInTheDocument()
  api.mockRejectedValueOnce(Error('Audit unavailable'))
  fireEvent.click(screen.getByText('Refresh audit'));expect(await screen.findByRole('alert')).toHaveTextContent('Audit unavailable')
  api.mockResolvedValueOnce({entries:[],count:0,has_more:false,timezone:'Africa/Harare'})
  fireEvent.click(screen.getByText('Retry'));expect(await screen.findByText('No entries yet')).toBeVisible()
})
it('shows retained business evidence and sends filters with timezone dates',async()=>{
  api.mockResolvedValue({entries:[{id:'1',action:'RELEASE_VEHICLE',actor:'Supervisor A',actor_ref:'1',timestamp:'2026-10-07T08:00:00Z',references:{vehicle:'SYNTH-1',visit:4,trip:3},reason:'Independent synthetic approval',previous_state:'OVERRIDE_APPROVED',new_state:'RELEASED',payload:'{"test":"synthetic"}',hash:'abc',previous_hash:'GENESIS'}],count:1,has_more:false,timezone:'Africa/Harare'})
  render(<AuditLog/>);expect(await screen.findByText('Vehicle SYNTH-1 / Visit 4 / Trip 3')).toBeVisible();expect(screen.getByText('Reason: Independent synthetic approval')).toBeVisible();expect(screen.getByText('State: OVERRIDE_APPROVED → RELEASED')).toBeVisible();expect(screen.getByText(/Display timezone: Africa\/Harare/)).toBeVisible()
  fireEvent.change(screen.getByLabelText('Vehicle, trip, actor or reason'),{target:{value:'SYNTH-1'}});fireEvent.change(screen.getByLabelText('From date (site timezone)'),{target:{value:'2026-10-07'}});fireEvent.click(screen.getByText('Apply filters'))
  expect(await screen.findByText('Vehicle SYNTH-1 / Visit 4 / Trip 3')).toBeVisible();expect(api.mock.calls.at(-1)?.[0]).toContain('q=SYNTH-1&from=2026-10-07')
})
