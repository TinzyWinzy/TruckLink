import { beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Onboarding from './Onboarding'
const api=vi.hoisted(()=>vi.fn())
vi.mock('../lib/api',()=>({apiFetch:api}))
vi.mock('../lib/subscriptions',()=>({readSubscription:()=>Promise.resolve({selection:{required_modules:['audit']},entitlement:{modules:['audit']}})}))
vi.mock('../store/session',()=>{
  const state={role:'ADMIN',workspace:{organisation:{id:1,name:'Test'},configuration:null,facilities:[],selectedFacility:''},setWorkspace:vi.fn()}
  return {useSession:Object.assign(()=>state,{getState:()=>state})}
})
vi.mock('../components/TenantSettings',()=>({default:()=> <p>Company settings form</p>}))
vi.mock('../components/ModuleSelection',()=>({default:()=> <p>Capability form</p>}))
vi.mock('../components/PlatformConfiguration',()=>({default:({stage}:{stage:string})=> <p>Configuration stage: {stage}</p>}))
vi.mock('../components/StaffProvisioning',()=>({default:()=> <p>Reviewer provisioning</p>}))
beforeEach(()=>{cleanup();api.mockReset();api.mockResolvedValue({revisions:[],sites:[{id:1,name:'Placeholder',timezone:'UTC',placeholder:true}]})})
it('shows real site creation and advances without claiming completion',async()=>{
  render(<MemoryRouter><Onboarding/></MemoryRouter>)
  await screen.findByText('Placeholder')
  expect(screen.getByRole('button',{name:'Create operational site'})).toBeInTheDocument()
  expect(screen.getByText('Needs setup')).toBeInTheDocument()
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Continue to Capabilities'}))})
  expect(screen.getByText('Capability form')).toBeInTheDocument()
  expect(screen.queryByText('Company settings form')).not.toBeInTheDocument()
  expect(screen.getByText('Needs setup')).toBeInTheDocument()
})
it('opens a shareable reviewer handoff with only the review stage',async()=>{
  render(<MemoryRouter initialEntries={['/onboarding?step=4']}><Onboarding/></MemoryRouter>)
  await screen.findByText('Configuration stage: review')
  expect(screen.getByText(/author cannot approve/)).toBeInTheDocument()
  expect(screen.queryByText('Company settings form')).not.toBeInTheDocument()
})
