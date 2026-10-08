import {beforeEach,it,expect,vi} from 'vitest'
import {render,screen,cleanup,fireEvent,waitFor} from '@testing-library/react'
import ModuleSelection from './ModuleSelection'
import {requiredModules,subscriptionSchema,type Subscription} from '../lib/subscriptions'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../lib/api',()=>({apiFetch:api}))

const catalogue:Subscription['catalogue']=[
  {key:'yard',name:'Yard control',description:'Arrivals and exits',requires:['inspection','release'],included:false},
  {key:'inspection',name:'Inspection',description:'Checks',requires:['yard'],included:false},
  {key:'release',name:'Release',description:'Release checks',requires:['inspection'],included:false},
  {key:'audit',name:'Audit',description:'History',requires:[],included:true},
]
const response:Subscription={organisation:{id:1,name:'Synthetic tenant'},catalogue,selection:null,
  entitlement:{version:0,state:'UNASSIGNED',basis:null,modules:['audit'],effective_from:null,effective_to:null},
  configured_modules:{audit:true,yard:false},effective_modules:{audit:true,yard:false},
  billing:{mode:'OPERATOR_APPROVED',prices_defined:false,checkout_available:false},unavailable:[]}
beforeEach(()=>{cleanup();api.mockReset()})
it('resolves safety dependencies despite cycles and always includes audit',()=>{
  expect(requiredModules(['yard'],catalogue)).toEqual(['audit','inspection','release','yard'])
  expect(requiredModules([],catalogue)).toEqual(['audit'])
  expect(subscriptionSchema.safeParse({...response,entitlement:{...response.entitlement,modules:['tracker']}}).success).toBe(false)
})
it('saves a versioned request without presenting it as active access',async()=>{
  api.mockResolvedValueOnce(response).mockResolvedValueOnce({...response,selection:{version:1,modules:['yard','audit'],required_modules:['audit','inspection','release','yard'],created_at:'2026-10-08T00:00:00Z',status:'REQUESTED'}})
  render(<ModuleSelection/>);expect(screen.getByRole('status')).toHaveTextContent('Loading')
  const checkbox=await screen.findByRole('checkbox',{name:/Yard control/})
  fireEvent.click(checkbox);fireEvent.click(screen.getByRole('button',{name:'Save module request'}))
  await screen.findByText('Saved request v1')
  expect(api).toHaveBeenLastCalledWith('/tenant/subscription/',{method:'POST',body:{modules:['audit','yard'],expected_version:0,reason:'Tenant administrator selected modules during onboarding.'}})
  expect(screen.getByRole('status')).toHaveTextContent('approval and operational activation are separate')
  expect(screen.getAllByText('Active')).toHaveLength(1) // audit only
  expect(screen.getByRole('checkbox',{name:/Audit/})).toBeDisabled()
})
it('reports failed loading and allows retry instead of claiming no subscription',async()=>{
  api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response)
  render(<ModuleSelection/>);await screen.findByRole('alert')
  expect(screen.queryByRole('button',{name:'Save module request'})).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Reload modules'}))
  await screen.findByRole('button',{name:'Save module request'})
  await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument())
})
