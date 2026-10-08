import {beforeEach,it,expect,vi} from 'vitest'
import {render,screen,cleanup,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import Workspace from './Workspace'
import {useSession} from '../store/session'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../lib/api',()=>({apiFetch:api}))
const payload={organisation:{id:1,name:'Synthetic company'},facility:{id:7,name:'West site'},role:'EXECUTIVE',as_of:'2026-10-08T00:00:00Z',activation_required:false,notice:'Scoped capability workspace',cards:[
  {key:'graphs',module:'reports',title:'Activity intelligence',description:'Recorded graphs',href:'/reports'},
  {key:'fleet',module:'fleet',title:'Fleet setup',description:'Admin only',href:'/admin'},
]}
beforeEach(()=>{cleanup();api.mockReset();useSession.getState().signInReal('5','EXECUTIVE','Synthetic reviewer');useSession.getState().setWorkspace({organisation:{id:1,name:'Synthetic company',slug:'synthetic'},facilities:[{id:7,name:'West site',slug:'west'}],selectedFacility:'7'})})
it('shows scoped cards and filters inaccessible actions',async()=>{
  api.mockResolvedValue(payload)
  render(<MemoryRouter><Workspace/></MemoryRouter>)
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(await screen.findByRole('link',{name:/Activity intelligence/})).toHaveAttribute('href','/reports')
  expect(screen.queryByText('Fleet setup')).not.toBeInTheDocument()
  expect(api).toHaveBeenCalledWith('/tenant/workspace/?facility=7')
})
it('rejects a response from another tenant instead of rendering its cards',async()=>{
  api.mockResolvedValue({...payload,organisation:{id:2,name:'Foreign'}})
  render(<MemoryRouter><Workspace/></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('scope changed')
  expect(screen.queryByText('Foreign')).not.toBeInTheDocument()
  expect(screen.queryByRole('link',{name:/Activity intelligence/})).not.toBeInTheDocument()
})
it('practice mode never fetches a company subscription',async()=>{
  useSession.getState().signInDemo('EXECUTIVE')
  render(<MemoryRouter><Workspace/></MemoryRouter>)
  await waitFor(()=>expect(screen.getByText(/Practice mode uses synthetic/)).toBeVisible())
  expect(api).not.toHaveBeenCalled()
})
