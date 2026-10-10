import {beforeEach,it,expect,vi} from 'vitest'
import {render,screen,cleanup,waitFor,within} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import Workspace from './Workspace'
import {useSession} from '../store/session'
const api=vi.hoisted(()=>vi.fn())
const live=vi.hoisted(()=>vi.fn(()=>true))
const dashboard=vi.hoisted(()=>vi.fn())
vi.mock('../lib/api',()=>({apiFetch:api}))
vi.mock('../lib/liveGate',()=>({useLive:live}))
vi.mock('../lib/dashboard',()=>({fetchDashboard:dashboard}))
const payload={organisation:{id:1,name:'Synthetic company'},facility:{id:7,name:'West site'},role:'EXECUTIVE',as_of:'2026-10-08T00:00:00Z',activation_required:false,notice:'Scoped capability workspace',cards:[
  {key:'graphs',module:'reports',title:'Activity intelligence',description:'Recorded graphs',href:'/reports'},
  {key:'fleet',module:'fleet',title:'Fleet setup',description:'Admin only',href:'/admin'},
]}
const snapshot={metric_version:'yard-dashboard-1',as_of:'2026-10-08T12:00:00Z',refresh_seconds:5,facility:{id:7,name:'West site',timezone:'Africa/Harare'},window:{key:'24h',from:'2026-10-07T12:00:00Z',to:'2026-10-08T12:00:00Z',bucket:'hour',partial_edge_buckets:true},series:[{at:'2026-10-08T12:00:00Z',arrivals:5,exits:2}],active_statuses:{QUEUED:3},age_buckets:[{label:'Under 30m',count:3}],summary:{active:3,blocked:1,arrivals:5,physical_exits:2,mean_turnaround_minutes:20},docks:null,alerts:null,coverage:{legacy_completions_excluded:0,invalid_exit_timestamps:0,future_arrivals_excluded:0,latest_yard_record_update:null,active_scope:'Recorded active visits.',exit_scope:'Recorded physical exits.',source:'Recorded Trucki yard data.',tracker:'NOT_CONFIGURED',erp:'NOT_CONFIGURED'}}
beforeEach(()=>{cleanup();api.mockReset();dashboard.mockReset().mockResolvedValue(snapshot);live.mockReturnValue(true);useSession.getState().signInReal('5','EXECUTIVE','Synthetic reviewer');useSession.getState().setWorkspace({organisation:{id:1,name:'Synthetic company',slug:'synthetic'},facilities:[{id:7,name:'West site',slug:'west'}],selectedFacility:'7'})})
it('shows scoped cards and filters inaccessible actions',async()=>{
  api.mockResolvedValue(payload)
  render(<MemoryRouter><Workspace/></MemoryRouter>)
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(await screen.findByRole('link',{name:/Activity intelligence/})).toHaveAttribute('href','/reports')
  expect(screen.queryByText('Fleet setup')).not.toBeInTheDocument()
  expect(api).toHaveBeenCalledWith('/tenant/workspace/?facility=7')
})
it('keeps the customer workspace available while setup and review are pending',async()=>{
  useSession.getState().signInReal('5','ADMIN','Synthetic administrator')
  api.mockResolvedValue({...payload,role:'ADMIN',activation_required:true})
  render(<MemoryRouter><Workspace/></MemoryRouter>)
  expect(await screen.findByRole('region',{name:'Setup status'})).toHaveTextContent('Operational actions unlock after the required review and release activation.')
  expect(screen.getByRole('link',{name:'Continue setup'})).toHaveAttribute('href','/onboarding')
  expect(screen.getByRole('link',{name:/Activity intelligence/})).toBeVisible()
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
  expect(await screen.findByText(/Synthetic practice snapshot — not live customer data/)).toBeVisible()
  expect(screen.getByText('8')).toBeVisible()
  expect(api).not.toHaveBeenCalled()
  expect(dashboard).not.toHaveBeenCalled()
})
it('shows a scoped activity snapshot and lets the customer refresh it',async()=>{
  api.mockResolvedValue(payload)
  render(<MemoryRouter><Workspace/></MemoryRouter>)
  const activity=await screen.findByRole('region',{name:'Activity snapshot'})
  await waitFor(()=>expect(within(activity).getByText('3')).toBeVisible())
  expect(within(activity).getByText('5')).toBeVisible()
  await waitFor(()=>expect(dashboard).toHaveBeenCalledWith('7','24h',expect.any(AbortSignal)))
  screen.getByRole('button',{name:'Refresh now'}).click()
  await waitFor(()=>expect(dashboard).toHaveBeenCalledTimes(2))
})
it('surfaces report access errors instead of implying the snapshot is live',async()=>{
  api.mockResolvedValue(payload)
  dashboard.mockRejectedValue(new Error('Reports access is unavailable.'))
  render(<MemoryRouter><Workspace/></MemoryRouter>)
  const alert=await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Reports access is unavailable.')
  expect(screen.getByRole('status')).toHaveTextContent('Refresh failed')
  expect(screen.getAllByText('Awaiting data')).toHaveLength(4)
})
it('does not request report data for roles without report access',async()=>{
  useSession.getState().signInReal('5','DISPATCH_SUPERVISOR','Synthetic dispatcher')
  api.mockResolvedValue({...payload,role:'DISPATCH_SUPERVISOR'})
  render(<MemoryRouter><Workspace/></MemoryRouter>)
  await screen.findByText('Synthetic company / West site · DISPATCH SUPERVISOR')
  expect(dashboard).not.toHaveBeenCalled()
})
