import {beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import VehicleEvidenceDesk from './VehicleEvidenceDesk'
import {apiFetch} from '../lib/api'
import {useSession} from '../store/session'
vi.mock('../lib/api',()=>({apiFetch:vi.fn()}))
beforeEach(()=>{cleanup();vi.clearAllMocks();useSession.getState().signInReal('42','COMPLIANCE_OFFICER','Reviewer')})
it('allows another author record to be reviewed while disabling self review',async()=>{
  vi.mocked(apiFetch).mockImplementation(async(path)=>path==='/vehicles/'?{vehicles:[]} : path==='/regulatory/evidence/'?{records:[
    {id:1,creator:42,kind:'VEHICLE_RATING',document_ref:'test://self',revision:1,review_status:'UNVERIFIED'},
    {id:2,creator:9,kind:'VEHICLE_RATING',document_ref:'test://other',revision:1,review_status:'UNVERIFIED'},
  ]}:{records:[]})
  render(<VehicleEvidenceDesk/>)
  fireEvent.click(screen.getByRole('button',{name:'Open evidence register'}))
  await screen.findByText('test://other / revision 1 / UNVERIFIED')
  fireEvent.change(screen.getByLabelText('Review reason'),{target:{value:'Compared with retained rating source'}})
  const approvals=screen.getAllByRole('button',{name:'Approve record'})
  expect(approvals[0]).toBeDisabled();expect(approvals[1]).toBeEnabled()
  fireEvent.click(approvals[1])
  await waitFor(()=>expect(apiFetch).toHaveBeenCalledWith('/regulatory/reviews/',{method:'POST',body:{subject:'evidence',subject_id:2,approved:true,reason:'Compared with retained rating source'}}))
})
it('does not expose evidence authoring to operations',()=>{
  useSession.getState().signInReal('42','OPERATIONS_SUPERVISOR','Operations')
  render(<VehicleEvidenceDesk/>)
  expect(screen.queryByRole('button',{name:'Open evidence register'})).not.toBeInTheDocument()
})
