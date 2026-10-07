import {it,expect,vi} from 'vitest'
import {render,screen,fireEvent,waitFor} from '@testing-library/react'
import MovementOwner from './MovementOwner'
import {useSession} from '../store/session'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../lib/api',()=>({apiFetch:api}))
it('records an eligible named handoff with its stage and expected assignment',async()=>{
  useSession.getState().signInReal('1','OPERATIONS_SUPERVISOR','Coordinator')
  api.mockResolvedValue({stage:'TRIP',assignment_id:null,owner_id:null,candidates:[{id:2,label:'Dispatcher A',role:'DISPATCH_SUPERVISOR'}]})
  const changed=vi.fn();render(<MovementOwner entryId={7} stage="TRIP" assignmentId={null} onChanged={changed}/>);fireEvent.click(screen.getByText('Assign the next handoff owner'))
  const staff=await screen.findByLabelText('Responsible staff member');expect(screen.getByRole('button',{name:'Assign accountable owner'})).toBeDisabled()
  fireEvent.change(staff,{target:{value:'2'}});fireEvent.change(screen.getByLabelText('Handoff assignment reason'),{target:{value:'Prepare the manifest'}});fireEvent.click(screen.getByRole('button',{name:'Assign accountable owner'}))
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/operations/7/owner/',{method:'POST',body:{stage:'TRIP',expected_assignment_id:null,owner_id:2,reason:'Prepare the manifest'}}));expect(changed).toHaveBeenCalled()
})
