import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import VersionedInspection from './VersionedInspection'
import { useSession } from '../store/session'
import { inspectOperational, type RegulatoryContext } from '../lib/regulatory'

vi.mock('../lib/regulatory', () => ({ inspectOperational: vi.fn(), getRegulatoryContext: vi.fn() }))

const data: RegulatoryContext = {
  mode: 'VERSIONED', readiness_error: null, attempt: null,
  context: { id: 5, driver: 2, trip: 3, load: 4, jurisdictions: ['TEST'], route_type: 'DOMESTIC', origin: 'A', destination: 'B' },
  configuration: { id: 9, revision: 1, vehicle: 1, vehicle_class: 'TEST', rated_axle_kg: ['12000','12000'], rated_gross_kg: '24000', review_status: 'REVIEWED' },
  rulesets: [],
}

beforeEach(() => {
  vi.clearAllMocks()
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

  it('shows missing context without inserting pilot ratings', () => {
    render(<VersionedInspection entryId="10" data={{ ...data, context: null, configuration: null }} changeEntry={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('have not been recorded')
    expect(screen.queryByText(/Recorded ratings/)).not.toBeInTheDocument()
  })
})
