import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import VersionedInspection from './VersionedInspection'
import { useSession } from '../store/session'
import { inspectOperational, type RegulatoryContext } from '../lib/regulatory'
import { apiFetch } from '../lib/api'
vi.mock('../lib/api',()=>({apiFetch:vi.fn()}))

vi.mock('../lib/regulatory', () => ({ inspectOperational: vi.fn(), getRegulatoryContext: vi.fn() }))

const data: RegulatoryContext = {
  mode: 'VERSIONED', readiness_error: null, attempt: null,
  context: { id: 5, driver: 2, trip: 3, load: 4, jurisdictions: ['TEST'], route_type: 'DOMESTIC', origin: 'A', destination: 'B' },
  configuration: { id: 9, revision: 1, vehicle: 1, vehicle_class: 'TEST', rated_axle_kg: ['12000','12000'], rated_gross_kg: '24000', review_status: 'REVIEWED' },
  rulesets: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiFetch).mockResolvedValue({entry:{registration:'TEST-123',status:'QUARANTINED'},trips:[{id:3,driver_name:'Test Driver'}],blockers:[{code:'TRIP',title:'Link the dispatched trip',owner:'Dispatch Supervisor'}]})
  useSession.getState().signInReal('inspector', 'DISPATCH_SUPERVISOR', 'Inspector')
})

describe('versioned operational inspection', () => {
  it('submits measured mass and context identity without caller ratings or limits', async () => {
    vi.mocked(inspectOperational).mockResolvedValue({ replayed: false, attempt: { id: 7, creator: 1, decision: 'HOLD',
      result: { controls: [{ id: 'document', status: 'HOLD', reason: 'Document missing' }], readiness_percent: 50,
        override_eligible: false, engine_version: 'nrok-1', monetary_penalty: null } } })
    render(<VersionedInspection entryId="10" data={data} changeEntry={() => {}} />)
    fireEvent.change(screen.getByLabelText('Axle 1'), { target: { value: '8000' } })
    fireEvent.change(screen.getByLabelText('Axle 2'), { target: { value: '8000' } })
    fireEvent.change(screen.getByLabelText('Total'), { target: { value: '16000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record versioned inspection' }))
    await waitFor(() => expect(inspectOperational).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(inspectOperational).mock.calls[0][0]
    expect(payload).toMatchObject({ queue_entry: 10, context_id: 5, axle_weights: ['8000','8000'], total_weight: '16000' })
    expect(payload).not.toHaveProperty('gvm_rating')
    expect(payload).not.toHaveProperty('limits')
    expect(await screen.findByText('Document missing', { exact: false })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Approve independently' })).not.toBeInTheDocument()
  })

  it('shows missing context without inserting pilot ratings', async () => {
    render(<VersionedInspection entryId="10" data={{ ...data, context: null, configuration: null }} changeEntry={() => {}} />)
    expect(screen.getByRole('heading',{name:'Complete setup before inspection'})).toBeVisible()
    expect(screen.getByText(/Setup required. Inspection and release remain blocked/)).toBeVisible()
    expect(screen.queryByRole('button',{name:'Record versioned inspection'})).not.toBeInTheDocument()
    expect(screen.queryByText(/Recorded ratings/)).not.toBeInTheDocument()
    expect(await screen.findByRole('heading',{name:'TEST-123'})).toBeVisible()
  })

  it('leads with recorded vehicle identity and keeps context details collapsed',async()=>{
    render(<VersionedInspection entryId="10" data={data} changeEntry={()=>{}}/>)
    expect(await screen.findByRole('heading',{name:'TEST-123'})).toBeVisible()
    const identity=screen.getByRole('region',{name:'Movement identity'})
    expect(within(identity).getByText('Test Driver')).toBeVisible()
    expect(within(identity).getByText('B')).toBeVisible()
    expect(screen.getByLabelText('Queue entry ID')).not.toBeVisible()
    fireEvent.click(screen.getByText('Recorded context and rule details'))
    expect(screen.getByLabelText('Queue entry ID')).toBeVisible()
  })

  it('gives a read-only reviewer the missing records and responsible roles',async()=>{
    useSession.getState().signInReal('reviewer','COMPLIANCE_OFFICER','Reviewer')
    render(<VersionedInspection entryId="10" data={{...data,context:null,configuration:null}} changeEntry={()=>{}}/>)
    expect(await screen.findByText('Responsible role: Dispatch Supervisor')).toBeVisible()
    expect(screen.getByText(/Read-only inspection access/)).toBeVisible()
    expect(screen.queryByRole('button',{name:'Complete operational setup'})).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'Record versioned inspection'})).not.toBeInTheDocument()
  })
})
