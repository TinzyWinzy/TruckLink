import { getPowerSyncDb } from './powersync'
import { validateLoad } from '../validation/compliance'
import { resolveSiLimits } from '../validation/siTables'

export interface QueueEntryRow {
  id: string
  facility_id: string
  reg_number: string
  driver_name: string
  haulier: string
  vehicle_type: string
  cargo_type: string
  status: 'QUEUED' | 'AT_DOCK' | 'COMPLETED' | 'QUARANTINED' | 'RELEASED'
  assigned_dock_id?: string | null
  entry_timestamp: string
  exit_timestamp?: string | null
  dwell_duration_seconds?: number | null
  created_at: string
  updated_at: string
}

export interface DockRow {
  id: string
  facility_id: string
  name: string
  status: 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE'
  current_vehicle_id?: string | null
  updated_at: string
}

export interface ComplianceCheckRow {
  id: string
  facility_id: string
  queue_id: string
  reg_number: string
  vehicle_type: string
  route_type: string
  axle_weights: string
  measured_total_kg: number
  max_permissible_kg: number
  overload_kg: number
  overload_fee_usd: number
  checklist_results: string
  status: 'PASSED' | 'QUARANTINED' | 'PENDING_OVERRIDE' | 'OVERRIDE_APPROVED'
  inspector_id: string
  timestamp: string
  override_reason?: string | null
  override_authorizer_id?: string | null
}

export interface AlertRow {
  id: string
  facility_id: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  message: string
  category: string
  acknowledged: number // 0 or 1
  acknowledged_by?: string | null
  timestamp: string
}

export interface AuditLogRow {
  id: string
  facility_id: string
  action: string
  payload: string
  actor_id: string
  timestamp: string
  previous_hash: string
  hash: string
}

const AUDIT_SALT = (import.meta.env.VITE_AUDIT_SALT as string | undefined) ?? 'pilot-salt-rotate-me'

async function sha256hex(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Append cryptographic audit entry into local SQLite audit_logs
 */
export async function appendAuditPS(
  facilityId: string,
  actorId: string,
  action: string,
  payload: Record<string, unknown>
): Promise<void> {
  const db = getPowerSyncDb()
  const last = await db.getOptional<{ hash: string }>(
    'SELECT hash FROM audit_logs WHERE facility_id = ? ORDER BY timestamp DESC LIMIT 1',
    [facilityId]
  )
  const previousHash = last?.hash || 'GENESIS'
  const payloadStr = JSON.stringify(payload)
  const timestamp = new Date().toISOString()
  const hash = await sha256hex(`${previousHash}${payloadStr}${AUDIT_SALT}`)
  const id = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  await db.execute(
    `INSERT INTO audit_logs (id, facility_id, action, payload, actor_id, timestamp, previous_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, facilityId, action, payloadStr, actorId, timestamp, previousHash, hash]
  )
}

/**
 * Register arriving vehicle at gate
 */
export async function registerVehiclePS(data: {
  facilityId: string
  regNumber: string
  driverName: string
  haulier: string
  vehicleType: string
  cargoType: string
  actorId: string
}): Promise<string> {
  const db = getPowerSyncDb()
  const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const now = new Date().toISOString()

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO queue_entries (
        id, facility_id, reg_number, driver_name, haulier, vehicle_type, cargo_type, status,
        assigned_dock_id, entry_timestamp, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.facilityId,
        data.regNumber.toUpperCase(),
        data.driverName,
        data.haulier,
        data.vehicleType,
        data.cargoType,
        'QUEUED',
        null,
        now,
        now,
        now
      ]
    )
  })

  await appendAuditPS(data.facilityId, data.actorId, 'CREATE_QUEUE_ENTRY', { id, ...data })
  return id
}

/**
 * Assign an available loading/unloading dock to a queued truck
 */
export async function assignDockPS(
  facilityId: string,
  queueEntryId: string,
  dockId: string,
  actorId: string
): Promise<void> {
  const db = getPowerSyncDb()
  const now = new Date().toISOString()

  await db.writeTransaction(async (tx) => {
    const dock = await tx.getOptional<{ status: string }>('SELECT status FROM docks WHERE id = ?', [dockId])
    if (!dock || dock.status !== 'AVAILABLE') {
      throw new Error('Selected dock is not available')
    }

    await tx.execute(
      'UPDATE docks SET status = ?, current_vehicle_id = ?, updated_at = ? WHERE id = ?',
      ['OCCUPIED', queueEntryId, now, dockId]
    )

    await tx.execute(
      'UPDATE queue_entries SET status = ?, assigned_dock_id = ?, updated_at = ? WHERE id = ?',
      ['AT_DOCK', dockId, now, queueEntryId]
    )
  })

  await appendAuditPS(facilityId, actorId, 'ASSIGN_DOCK', { queueEntryId, dockId })
}

/**
 * Release vehicle at gate on exit and compute dwell time
 */
export async function releaseVehiclePS(
  facilityId: string,
  queueEntryId: string,
  actorId: string
): Promise<void> {
  const db = getPowerSyncDb()
  const now = new Date().toISOString()

  await db.writeTransaction(async (tx) => {
    const row = await tx.getOptional<{ entry_timestamp: string; assigned_dock_id?: string }>(
      'SELECT entry_timestamp, assigned_dock_id FROM queue_entries WHERE id = ?',
      [queueEntryId]
    )
    if (!row) throw new Error('Vehicle entry not found')

    const entryTime = new Date(row.entry_timestamp).getTime()
    const exitTime = new Date(now).getTime()
    const dwellSeconds = Math.max(0, Math.floor((exitTime - entryTime) / 1000))

    await tx.execute(
      `UPDATE queue_entries 
       SET status = 'RELEASED', exit_timestamp = ?, dwell_duration_seconds = ?, updated_at = ? 
       WHERE id = ?`,
      [now, dwellSeconds, now, queueEntryId]
    )

    if (row.assigned_dock_id) {
      await tx.execute(
        `UPDATE docks SET status = 'AVAILABLE', current_vehicle_id = NULL, updated_at = ? WHERE id = ?`,
        [now, row.assigned_dock_id]
      )
    }
  })

  await appendAuditPS(facilityId, actorId, 'RELEASE_VEHICLE', { queueEntryId })
}

/**
 * Submit statutory compliance check (S.I. 129 / 159)
 */
export async function submitCompliancePS(input: {
  facilityId: string
  queueEntryId: string
  regNumber: string
  vehicleType: string
  routeType: string
  axleWeights: [number, number, number]
  limits?: [number, number, number]
  totalWeight: number
  gvmRating: number
  checklistResults: Record<string, boolean>
  inspectorId: string
}): Promise<{ status: 'PASSED' | 'QUARANTINED'; checkId: string }> {
  const resolvedLimits = input.limits ?? (resolveSiLimits(input.routeType, input.vehicleType, undefined) as [number, number, number])
  const result = validateLoad({
    axleConfiguration: '2-4-2',
    measuredWeights: [...input.axleWeights],
    limits: [...resolvedLimits],
    totalWeight: input.totalWeight,
    gvmRating: input.gvmRating
  })

  const totalOverloadKg = Math.max(
    0,
    result.axles.reduce((acc, a) => acc + Math.max(0, a.measuredWeight - a.limit), 0),
    input.totalWeight - input.gvmRating
  )
  const estimatedFineUsd = totalOverloadKg * 0.50

  const isPassed = result.overallStatus === 'PASS'
  const checkStatus = isPassed ? 'PASSED' : 'QUARANTINED'
  const checkId = `chk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const now = new Date().toISOString()
  const db = getPowerSyncDb()

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO compliance_checks (
        id, facility_id, queue_id, reg_number, vehicle_type, route_type, axle_weights,
        measured_total_kg, max_permissible_kg, overload_kg, overload_fee_usd,
        checklist_results, status, inspector_id, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        checkId,
        input.facilityId,
        input.queueEntryId,
        input.regNumber.toUpperCase(),
        input.vehicleType,
        input.routeType,
        JSON.stringify(input.axleWeights),
        input.totalWeight,
        input.gvmRating,
        totalOverloadKg,
        estimatedFineUsd,
        JSON.stringify(input.checklistResults),
        checkStatus,
        input.inspectorId,
        now
      ]
    )

    if (!isPassed) {
      // Quarantine vehicle in queue
      await tx.execute(
        `UPDATE queue_entries SET status = ?, updated_at = ? WHERE id = ?`,
        ['QUARANTINED', now, input.queueEntryId]
      )

      // Create CRITICAL alert for yard supervisor
      const alertId = `alr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      await tx.execute(
        `INSERT INTO alerts (id, facility_id, severity, message, category, acknowledged, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          alertId,
          input.facilityId,
          'CRITICAL',
          `QUARANTINE: ${input.regNumber.toUpperCase()} failed axle check (+${totalOverloadKg}kg, fine $${estimatedFineUsd}). Rebalancing required.`,
          'COMPLIANCE',
          0,
          now
        ]
      )
    } else {
      await tx.execute(
        `UPDATE queue_entries SET status = ?, updated_at = ? WHERE id = ?`,
        ['COMPLETED', now, input.queueEntryId]
      )
    }
  })

  await appendAuditPS(input.facilityId, input.inspectorId, 'SUBMIT_COMPLIANCE', {
    checkId,
    status: checkStatus,
    overloadKg: totalOverloadKg,
    fineUsd: estimatedFineUsd
  })

  return { status: checkStatus, checkId }
}

/**
 * Secondary-approver override workflow (Tech Spec §5.3 / SAD §6)
 * Enforces secondary approval rule: authorizer cannot be the original inspector.
 */
export async function approveOverridePS(input: {
  facilityId: string
  checkId: string
  authorizerId: string
  reason: string
}): Promise<void> {
  const db = getPowerSyncDb()
  const now = new Date().toISOString()

  await db.writeTransaction(async (tx) => {
    const check = await tx.getOptional<{ inspector_id: string; queue_id: string; status: string }>(
      'SELECT inspector_id, queue_id, status FROM compliance_checks WHERE id = ?',
      [input.checkId]
    )

    if (!check) {
      throw new Error('Compliance check not found')
    }

    if (check.inspector_id === input.authorizerId) {
      throw new Error('Secondary approval violation: authorizer cannot be the original inspector')
    }

    if (check.status !== 'QUARANTINED' && check.status !== 'PENDING_OVERRIDE') {
      throw new Error(`Cannot override check with status ${check.status}`)
    }

    await tx.execute(
      `UPDATE compliance_checks 
       SET status = ?, override_reason = ?, override_authorizer_id = ? 
       WHERE id = ?`,
      ['OVERRIDE_APPROVED', input.reason, input.authorizerId, input.checkId]
    )

    await tx.execute(
      `UPDATE queue_entries SET status = ?, updated_at = ? WHERE id = ?`,
      ['COMPLETED', now, check.queue_id]
    )
  })

  await appendAuditPS(input.facilityId, input.authorizerId, 'APPROVE_OVERRIDE', {
    checkId: input.checkId,
    reason: input.reason
  })
}

/**
 * Acknowledge yard alert
 */
export async function acknowledgeAlertPS(
  facilityId: string,
  alertId: string,
  actorId: string
): Promise<void> {
  const db = getPowerSyncDb()
  await db.execute(
    'UPDATE alerts SET acknowledged = 1, acknowledged_by = ? WHERE id = ?',
    [actorId, alertId]
  )
  await appendAuditPS(facilityId, actorId, 'ACKNOWLEDGE_ALERT', { alertId })
}
