import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import MovementRecoveryPanel from './MovementRecoveryPanel'
import type { Movement } from './MovementWorklist'

const movement: Movement = {
  id: 14,
  plate: 'TEST-014',
  status: 'QUARANTINED',
  driver_name: 'Test Driver',
  trip_id: null,
  journey_linked: false,
  age_minutes: 10,
  stage_wait_started_at: null,
  stage_wait_minutes: null,
  stage_wait_basis: 'No retained stage timestamp',
  context_id: null,
  attempt_id: 3,
  decision: 'QUARANTINE',
  blockers: [
    { code: 'VEHICLE', title: 'Register the vehicle with this exact registration', owner: 'Fleet administrator' },
    { code: 'TRIP', title: 'Assign this vehicle and an active driver to a trip for this yard', owner: 'Dispatcher' },
  ],
  next_action: {
    stage: 'FLEET',
    label: 'Register the vehicle with this exact registration',
    href: '/dispatch?entry=14',
    owner_roles: ['ADMIN'],
    assigned_person: null,
    assignment_id: null,
  },
}

it('turns a quarantined movement next action into a direct stage destination', () => {
  const onOpenStage = vi.fn()
  render(<MovementRecoveryPanel movement={movement} onOpenStage={onOpenStage} />)

  expect(screen.getByText(/not cleared for release/i)).toBeVisible()
  expect(screen.getByText('Register the vehicle with this exact registration')).toBeVisible()
  expect(screen.getByText(/Responsible: admin/i)).toBeVisible()
  expect(screen.getByText(/Handoff owner: Unassigned/i)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Open Vehicle + driver' }))
  expect(onOpenStage).toHaveBeenCalledWith('FLEET')

  expect(screen.getByText('Assign this vehicle and an active driver to a trip for this yard')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Open Trip + visit link' }))
  expect(onOpenStage).toHaveBeenCalledWith('TRIP')
})

it('does not imply clearance when no setup blockers are reported', () => {
  const ready = {
    ...movement,
    status: 'AT_DOCK',
    decision: null,
    blockers: [],
    next_action: { ...movement.next_action, stage: 'INSPECTION', label: 'Record inspection', owner_roles: [] },
  }
  render(<MovementRecoveryPanel movement={ready} onOpenStage={vi.fn()} />)

  expect(screen.getByText(/No setup blockers are currently reported/i)).toBeVisible()
  expect(screen.getByText(/does not confirm inspection, approval, release, or clearance/i)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Open Inspection' })).toBeVisible()
})

it('explains when an independent approval is pending', () => {
  const awaitingApproval = {
    ...movement,
    status: 'PENDING_OVERRIDE',
    decision: 'REVIEW_REQUIRED',
    blockers: [],
    next_action: { ...movement.next_action, stage: 'APPROVAL', label: 'Review the exception request' },
  }
  render(<MovementRecoveryPanel movement={awaitingApproval} onOpenStage={vi.fn()} />)

  expect(screen.getByText(/waiting for an independent approval decision/i)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Open Approval' })).toBeVisible()
})
