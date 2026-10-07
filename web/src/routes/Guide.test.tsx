import {beforeEach,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import Guide from './Guide'
import {useSession} from '../store/session'
import {apiFetch} from '../lib/api'
vi.mock('../lib/liveGate',()=>({useLive:()=>!useSession.getState().userId?.startsWith('demo-')}))
vi.mock('../lib/api',()=>({apiFetch:vi.fn()}))
beforeEach(()=>{cleanup();vi.clearAllMocks();localStorage.clear();useSession.getState().signInDemo('EXECUTIVE')})
it('explains all responsibilities while restricting screen links and treating ticks as learning',()=>{
  render(<MemoryRouter><Guide/></MemoryRouter>)
  expect(screen.getByRole('heading',{name:'Operational walkthrough'})).toBeVisible()
  expect(screen.queryByRole('link',{name:'Open admin'})).not.toBeInTheDocument()
  expect(screen.getAllByRole('link',{name:'Open audit'})[0]).toBeVisible()
  fireEvent.change(screen.getByLabelText('Show responsibility'),{target:{value:'OPERATIONS_SUPERVISOR'}})
  expect(screen.queryByRole('heading',{name:'Prepare staff and site access'})).not.toBeInTheDocument()
  expect(screen.getByRole('heading',{name:'Authorise and receive rejected consignments'})).toBeVisible()
  fireEvent.click(screen.getAllByRole('button',{name:'Mark reviewed'})[0])
  expect(screen.getByRole('button',{name:'Reviewed'})).toHaveAttribute('aria-pressed','true')
  expect(apiFetch).not.toHaveBeenCalled()
})
it('loads scoped readiness and provides an owned visit link without operational writes',async()=>{
  useSession.getState().signInReal('5','OPERATIONS_SUPERVISOR','Reviewer')
  useSession.setState({workspace:{organisation:{id:1,name:'Tenant',slug:'tenant'},facilities:[{id:7,name:'Yard',slug:'yard'}],selectedFacility:'7'}})
  vi.mocked(apiFetch).mockResolvedValue({counts:{vehicles:0,visits:1},visits:[{id:12,plate:'TEST',status:'QUARANTINED'}],integrations:{erp:'NOT_CONFIGURED',tracker:'NOT_CONFIGURED'},notice:'Counts are not clearance.'})
  render(<MemoryRouter><Guide/></MemoryRouter>)
  await screen.findByText('Counts are not clearance.')
  fireEvent.change(screen.getByLabelText('Inspect an existing visit'),{target:{value:'12'}})
  expect(screen.getByRole('link',{name:'Open visit inspection'})).toHaveAttribute('href','/compliance?entry=12')
  expect(apiFetch).toHaveBeenCalledExactlyOnceWith('/walkthrough/?facility=7')
})
