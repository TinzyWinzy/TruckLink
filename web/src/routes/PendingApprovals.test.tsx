import {beforeEach,it,expect,vi} from 'vitest'
import {render,screen,cleanup,fireEvent,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import PendingApprovals from './PendingApprovals'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../lib/api',()=>({facilityId:'7',apiFetch:api}))
vi.mock('../lib/liveGate',()=>({useLive:()=>true}))
beforeEach(()=>{cleanup();api.mockReset()})
it('requires a reason and only enables independent review afforded by the server',async()=>{
  api.mockResolvedValue({as_of:'2026-10-07T08:00:00Z',scope:'Synthetic',expired:[],exceptions:[],evidence_reviews:[{id:1,subject:'evidence',label:'Own evidence',creator_id:1,last_review:'PENDING',can_review:false,document_ref:'test://own',document_sha256:'a'.repeat(64)},{id:2,subject:'configuration',label:'Independent review',creator_id:2,last_review:'PENDING',can_review:true,document_ref:'test://other',document_sha256:'b'.repeat(64)}]})
  render(<MemoryRouter><PendingApprovals/></MemoryRouter>)
  expect(await screen.findByText('Own evidence')).toBeVisible();expect(screen.queryByRole('button',{name:'Approve evidence 1'})).not.toBeInTheDocument()
  const approve=screen.getByRole('button',{name:'Approve configuration 2'});expect(approve).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Decision reason'),{target:{value:'Reviewed original synthetic rating'}});fireEvent.click(approve)
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/regulatory/reviews/',{method:'POST',body:{subject:'configuration',subject_id:2,approved:true,reason:'Reviewed original synthetic rating'}}))
})
