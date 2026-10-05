import { describe, it, expect, beforeEach } from 'vitest'
import { getPowerSyncDb } from './powersync'
import {
  registerVehiclePS,
  assignDockPS,
  submitCompliancePS,
  approveOverridePS,
  releaseVehiclePS,
  acknowledgeAlertPS
} from './operations'

describe('PowerSync SQLite Operations & Workflows', () => {
  const facilityId = 'demo-facility'
  const inspectorId = 'user-gate-01'
  const supervisorId = 'user-super-02'

  beforeEach(async () => {
    const db = getPowerSyncDb()
    await db.init()
    // Reset test tables
    await db.execute('DELETE FROM queue_entries')
    await db.execute('DELETE FROM docks')
    await db.execute('DELETE FROM compliance_checks')
    await db.execute('DELETE FROM alerts')
    await db.execute('DELETE FROM audit_logs')

    // Seed test dock
    await db.execute(
      `INSERT INTO docks (id, facility_id, name, status, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['D1', facilityId, 'Dock 1 (Bulk)', 'AVAILABLE', new Date().toISOString()]
    )
  })

  it('registers a vehicle at gate and logs audit trail', async () => {
    const db = getPowerSyncDb()
    const qId = await registerVehiclePS({
      facilityId,
      regNumber: 'AFK-4921',
      driverName: 'T. Moyo',
      haulier: 'CrossBorder Haulage',
      vehicleType: 'FLATBED',
      cargoType: 'Agricultural inputs',
      actorId: inspectorId
    })

    expect(qId).toMatch(/^q-/)

    const row = await db.getOptional<{ reg_number: string; status: string }>(
      'SELECT reg_number, status FROM queue_entries WHERE id = ?',
      [qId]
    )
    expect(row).toBeDefined()
    expect(row?.reg_number).toBe('AFK-4921')
    expect(row?.status).toBe('QUEUED')

    const audit = await db.getOptional<{ action: string }>(
      'SELECT action FROM audit_logs WHERE facility_id = ? ORDER BY timestamp DESC LIMIT 1',
      [facilityId]
    )
    expect(audit?.action).toBe('CREATE_QUEUE_ENTRY')
  })

  it('assigns an available dock transactionally', async () => {
    const db = getPowerSyncDb()
    const qId = await registerVehiclePS({
      facilityId,
      regNumber: 'ABZ-9901',
      driverName: 'C. Sibanda',
      haulier: 'SADC Logistics',
      vehicleType: 'CONTAINER',
      cargoType: 'Tobacco exports',
      actorId: inspectorId
    })

    await assignDockPS(facilityId, qId, 'D1', supervisorId)

    const dock = await db.getOptional<{ status: string; current_vehicle_id: string }>(
      'SELECT status, current_vehicle_id FROM docks WHERE id = "D1"'
    )
    expect(dock?.status).toBe('OCCUPIED')
    expect(dock?.current_vehicle_id).toBe(qId)

    const queue = await db.getOptional<{ status: string; assigned_dock_id: string }>(
      'SELECT status, assigned_dock_id FROM queue_entries WHERE id = ?',
      [qId]
    )
    expect(queue?.status).toBe('AT_DOCK')
    expect(queue?.assigned_dock_id).toBe('D1')
  })

  it('flags overloaded vehicle, triggers quarantine & creates CRITICAL alert', async () => {
    const db = getPowerSyncDb()
    const qId = await registerVehiclePS({
      facilityId,
      regNumber: 'OVR-1234',
      driverName: 'E. Dube',
      haulier: 'North Haul Ltd',
      vehicleType: 'FLATBED',
      cargoType: 'Mining machinery',
      actorId: inspectorId
    })

    // Axle 2 overloaded (11000kg vs 9000kg limit) -> 2000kg excess -> $1000 fine
    const result = await submitCompliancePS({
      facilityId,
      queueEntryId: qId,
      regNumber: 'OVR-1234',
      vehicleType: 'FLATBED',
      routeType: 'BEITBRIDGE',
      axleWeights: [7500, 11000, 8500],
      limits: [8000, 9000, 9000],
      totalWeight: 27000,
      gvmRating: 28000,
      checklistResults: { 'license-check': true },
      inspectorId
    })

    expect(result.status).toBe('QUARANTINED')

    const queue = await db.getOptional<{ status: string }>(
      'SELECT status FROM queue_entries WHERE id = ?',
      [qId]
    )
    expect(queue?.status).toBe('QUARANTINED')

    const alert = await db.getOptional<{ severity: string; acknowledged: number }>(
      'SELECT severity, acknowledged FROM alerts WHERE facility_id = ? ORDER BY timestamp DESC LIMIT 1',
      [facilityId]
    )
    expect(alert?.severity).toBe('CRITICAL')
    expect(alert?.acknowledged).toBe(0)
  })

  it('enforces secondary-approver rule on quarantine override', async () => {
    const qId = await registerVehiclePS({
      facilityId,
      regNumber: 'SEC-5544',
      driverName: 'P. Ndlovu',
      haulier: 'Trans Zambezi',
      vehicleType: 'DRY_VAN',
      cargoType: 'Packaged goods',
      actorId: inspectorId
    })

    const { checkId } = await submitCompliancePS({
      facilityId,
      queueEntryId: qId,
      regNumber: 'SEC-5544',
      vehicleType: 'DRY_VAN',
      routeType: 'HARARE_LOCAL',
      axleWeights: [7500, 9800, 8500], // 800kg overload
      limits: [8000, 9000, 9000],
      totalWeight: 25800,
      gvmRating: 28000,
      checklistResults: {},
      inspectorId
    })

    // Attempt 1: Same inspector tries to approve their own check -> MUST FAIL
    await expect(
      approveOverridePS({
        facilityId,
        checkId,
        authorizerId: inspectorId, // Same as inspectorId!
        reason: 'Self override attempt'
      })
    ).rejects.toThrow(/Secondary approval violation/)

    // Attempt 2: Distinct supervisor approves -> SUCCEEDS
    await approveOverridePS({
      facilityId,
      checkId,
      authorizerId: supervisorId,
      reason: 'Authorised decanting of excess payload at Bay 4'
    })

    const db = getPowerSyncDb()
    const check = await db.getOptional<{ status: string; override_reason: string }>(
      'SELECT status, override_reason FROM compliance_checks WHERE id = ?',
      [checkId]
    )
    expect(check?.status).toBe('OVERRIDE_APPROVED')
    expect(check?.override_reason).toContain('decanting')

    const queue = await db.getOptional<{ status: string }>(
      'SELECT status FROM queue_entries WHERE id = ?',
      [qId]
    )
    expect(queue?.status).toBe('COMPLETED')
  })

  it('releases vehicle and calculates dwell duration', async () => {
    const db = getPowerSyncDb()
    const qId = await registerVehiclePS({
      facilityId,
      regNumber: 'REL-0011',
      driverName: 'K. Biti',
      haulier: 'FastTrack Freight',
      vehicleType: 'REFRIGERATED',
      cargoType: 'Horticultural produce',
      actorId: inspectorId
    })

    await assignDockPS(facilityId, qId, 'D1', supervisorId)
    await releaseVehiclePS(facilityId, qId, inspectorId)

    const queue = await db.getOptional<{ status: string; dwell_duration_seconds: number }>(
      'SELECT status, dwell_duration_seconds FROM queue_entries WHERE id = ?',
      [qId]
    )
    expect(queue?.status).toBe('RELEASED')
    expect(typeof queue?.dwell_duration_seconds).toBe('number')

    const dock = await db.getOptional<{ status: string }>(
      'SELECT status FROM docks WHERE id = "D1"'
    )
    expect(dock?.status).toBe('AVAILABLE')
  })

  it('acknowledges active alerts in SQLite', async () => {
    const db = getPowerSyncDb()
    const alertId = 'alr-test-123'
    await db.execute(
      `INSERT INTO alerts (id, facility_id, severity, message, category, acknowledged, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [alertId, facilityId, 'HIGH', 'Test high priority warning', 'SYSTEM', 0, new Date().toISOString()]
    )

    await acknowledgeAlertPS(facilityId, alertId, supervisorId)

    const alert = await db.getOptional<{ acknowledged: number; acknowledged_by: string }>(
      'SELECT acknowledged, acknowledged_by FROM alerts WHERE id = ?',
      [alertId]
    )
    expect(alert?.acknowledged).toBe(1)
    expect(alert?.acknowledged_by).toBe(supervisorId)
  })
})
