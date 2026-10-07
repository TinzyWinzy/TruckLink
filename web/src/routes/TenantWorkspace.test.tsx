import {beforeEach,it,expect,vi} from 'vitest'
import {render,screen,cleanup,act,waitFor} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import Alerts from './Alerts'
import DockBoard from './DockBoard'
import {useSession} from '../store/session'
import type {LiveRow} from '../lib/live'
const feeds=vi.hoisted(()=>new Map<string,{rows:(rows:LiveRow[])=>void;error?:(message:string|null)=>void}>())
vi.mock('../lib/liveGate',()=>({useLive:()=>true}))
vi.mock('../lib/live',()=>({subscribe:vi.fn((name:string,rows:(r:LiveRow[])=>void,_max:number,error?:(m:string|null)=>void)=>{feeds.set(name,{rows,error});return ()=>{}})}))
vi.mock('../lib/push',()=>({isPushAvailable:()=>false}))
vi.mock('../components/VehicleEvidenceDesk',()=>({default:()=>null}))
beforeEach(()=>{cleanup();feeds.clear();useSession.getState().signInReal('5','OPERATIONS_SUPERVISOR','Reviewer');useSession.setState({workspace:{organisation:{id:1,name:'Example Transport',slug:'example'},facilities:[{id:7,name:'West Distribution Site',slug:'west'}],selectedFacility:'7'}})})
it.each([
  ['alerts',Alerts,'Loading alerts…','Yard is quiet'],
  ['docks',DockBoard,'Loading docks…','No docks configured'],
] as const)('%s distinguishes loading, failed and confirmed empty data',async(name,Screen,loading,empty)=>{
  render(<MemoryRouter><Screen/></MemoryRouter>)
  expect(screen.getByText(loading)).toBeVisible();expect(screen.queryByText(empty)).not.toBeInTheDocument()
  await waitFor(()=>expect(feeds.has(name)).toBe(true))
  act(()=>feeds.get(name)!.error?.('Site data unavailable'))
  expect(screen.getByRole('alert')).toHaveTextContent('Site data unavailable')
  expect(screen.queryByText(empty)).not.toBeInTheDocument()
  act(()=>{feeds.get(name)!.rows([]);feeds.get(name)!.error?.(null)})
  expect(screen.getByText(empty)).toBeVisible();expect(screen.queryByText(loading)).not.toBeInTheDocument()
})
it('uses the selected tenant site without asserting an unconfigured yard area',()=>{
  render(<MemoryRouter><DockBoard/></MemoryRouter>)
  expect(screen.getByText('West Distribution Site')).toBeVisible()
  expect(screen.queryByText(/72,000|BAK|Trinitas/)).not.toBeInTheDocument()
})
