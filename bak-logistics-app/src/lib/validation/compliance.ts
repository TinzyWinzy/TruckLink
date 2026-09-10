import { z } from 'zod'

// Compliance validation engine (Spec §10). Pure functions — tested to >90% per test plan.
// Axle config format: "2-4-2" style segment labels; measuredWeights align by position index.

export const axleCheckSchema = z.object({
  axleConfiguration: z.string().min(1, 'Axle configuration is required'),
  measuredWeights: z.array(z.number().nonnegative()).min(1, 'At least one axle weight is required'),
  limits: z.array(z.number().positive()).min(1, 'Limits are required'),
  totalWeight: z.number().nonnegative(),
  gvmRating: z.number().positive(),
})

export type AxleCheckInput = z.infer<typeof axleCheckSchema>
export type CheckStatus = 'PASS' | 'FAIL'

export interface AxleResult {
  axlePosition: number
  measuredWeight: number
  limit: number
  status: CheckStatus
}

export interface ComplianceResult {
  axles: AxleResult[]
  gvmStatus: CheckStatus
  overallStatus: CheckStatus | 'OVERRIDE_APPROVED'
  violations: string[]
}

export function validateLoad(raw: AxleCheckInput): ComplianceResult {
  const input = axleCheckSchema.parse(raw)
  if (input.measuredWeights.length !== input.limits.length) {
    throw new Error('measuredWeights and limits must have the same length')
  }
  const violations: string[] = []
  const axles: AxleResult[] = input.measuredWeights.map((w, i) => {
    const limit = input.limits[i]
    const status: CheckStatus = w <= limit ? 'PASS' : 'FAIL'
    if (status === 'FAIL') violations.push(`Axle ${i + 1}: ${w}kg exceeds limit ${limit}kg`)
    return { axlePosition: i + 1, measuredWeight: w, limit, status }
  })
  const gvmStatus: CheckStatus = input.totalWeight <= input.gvmRating ? 'PASS' : 'FAIL'
  if (gvmStatus === 'FAIL') {
    violations.push(`Total ${input.totalWeight}kg exceeds GVM ${input.gvmRating}kg`)
  }
  const overallStatus: CheckStatus = violations.length === 0 ? 'PASS' : 'FAIL'
  return { axles, gvmStatus, overallStatus, violations }
}

export const queueEntrySchema = z.object({
  licensePlate: z
    .string()
    .min(2, 'License plate is required')
    .max(12)
    .regex(/^[A-Z0-9][A-Z0-9 -]{1,11}$/i, 'Invalid license plate format'),
  driverName: z.string().min(2, 'Driver name is required'),
  cargoType: z.string().min(2, 'Cargo type is required'),
  expectedDestination: z.string().min(2, 'Destination is required'),
  cargoWeight: z.number().nonnegative().optional(),
})

export type QueueEntryInput = z.infer<typeof queueEntrySchema>

// Quarantine state machine (Spec §10.3)
export type GateState =
  | 'QUEUED'
  | 'ASSIGNED'
  | 'LOADING'
  | 'COMPLETED'
  | 'QUARANTINED'
  | 'PENDING_OVERRIDE'
  | 'OVERRIDE_APPROVED'
  | 'RELEASED'

const TRANSITIONS: Record<GateState, GateState[]> = {
  QUEUED: ['ASSIGNED'],
  ASSIGNED: ['LOADING'],
  LOADING: ['COMPLETED', 'QUARANTINED'],
  COMPLETED: ['QUARANTINED', 'RELEASED'],
  QUARANTINED: ['PENDING_OVERRIDE'],
  PENDING_OVERRIDE: ['OVERRIDE_APPROVED', 'QUARANTINED'],
  OVERRIDE_APPROVED: ['RELEASED'],
  RELEASED: [],
}

export function canTransition(from: GateState, to: GateState): boolean {
  return TRANSITIONS[from].includes(to)
}
