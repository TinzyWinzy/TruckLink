import {beforeEach,it,expect,vi} from 'vitest'
import {render,screen,cleanup,fireEvent} from '@testing-library/react'
import DockSetup from './DockSetup'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../lib/api',()=>({apiFetch:api,facilityId:'7'}))
beforeEach(()=>{cleanup();api.mockReset()})
it('malformed dock responses show a recoverable error instead of crashing or claiming an empty site',async()=>{
  api.mockResolvedValueOnce({}).mockResolvedValueOnce({docks:[]})
  render(<DockSetup/>);expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be read')
  expect(screen.queryByText('No docks configured for this site.')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Refresh docks'}))
  expect(await screen.findByText('No docks configured for this site.')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
