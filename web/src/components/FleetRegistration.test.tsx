import {it,vi,expect} from 'vitest'
import {render,screen,fireEvent,waitFor} from '@testing-library/react'
import FleetRegistration from './FleetRegistration'
import {apiFetch} from '../lib/api'
vi.mock('../lib/api',()=>({apiFetch:vi.fn()}))
it('registers the entered plate without inventing vehicle ratings',async()=>{
  vi.mocked(apiFetch).mockResolvedValue({})
  render(<FleetRegistration/>)
  fireEvent.click(screen.getByText('Register a vehicle',{exact:true}))
  fireEvent.change(screen.getByLabelText('Vehicle registration'),{target:{value:' actual-123 '}})
  fireEvent.click(screen.getByRole('button',{name:'Save fleet vehicle'}))
  await waitFor(()=>expect(apiFetch).toHaveBeenCalledWith('/vehicles/',{method:'POST',body:{plate:'ACTUAL-123',make:'',model:''}}))
  expect(await screen.findByText(/Refresh the evidence register/)).toBeVisible()
})
