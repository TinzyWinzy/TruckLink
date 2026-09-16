/**
 * Pilot seed — run against the Firestore emulator or staging:
 *   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; npm run seed
 * Idempotent: uses fixed doc IDs with merge writes.
 */
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

initializeApp()
const db = getFirestore()

const FACILITY = process.env.BAK_FACILITY_ID ?? 'demo-facility'

async function main(): Promise<void> {
  const fac = db.doc(`facilities/${FACILITY}`)
  await fac.set(
    {
      name: 'BAK Pilot Facility',
      timezone: 'Africa/Harare',
      operatingHours: { open: '06:00', close: '22:00' },
      dockCount: 4,
      equipmentFleetSize: 3,
      waitThresholdMinutes: 60,
      updatedAt: new Date(),
    },
    { merge: true },
  )

  const docks = [
    { id: 'D1', name: 'Dock 1', capacity: 24000, status: 'OCCUPIED' },
    { id: 'D2', name: 'Dock 2', capacity: 24000, status: 'AVAILABLE' },
    { id: 'D3', name: 'Dock 3', capacity: 18000, status: 'AVAILABLE' },
    { id: 'D4', name: 'Dock 4', capacity: 24000, status: 'MAINTENANCE' },
  ]
  for (const d of docks) {
    await db.doc(`facilities/${FACILITY}/docks/${d.id}`).set(
      { ...d, currentAssignment: null, createdAt: new Date() },
      { merge: true },
    )
  }

  const equipment = [
    { id: 'FL-01', type: 'FORKLIFT', status: 'AVAILABLE' },
    { id: 'FL-02', type: 'FORKLIFT', status: 'IN_USE' },
    { id: 'TR-01', type: 'TRAILER', status: 'AVAILABLE' },
  ]
  for (const e of equipment) {
    await db.doc(`facilities/${FACILITY}/equipment/${e.id}`).set(
      { ...e, currentAssignment: null, createdAt: new Date() },
      { merge: true },
    )
  }

  await db.doc(`facilities/${FACILITY}/complianceConfig/default`).set(
    {
      axleLimits: { default: [8000, 9000, 9000] },
      siTables: {
        DEFAULT: [8000, 9000, 9000],
        FLATBED: [8000, 9000, 9000],
        TANKER: [8000, 8000, 9000],
        REFRIGERATED: [7500, 9000, 9000],
        CONTAINER: [8000, 9000, 9000],
        DRY_VAN: [8000, 9000, 9000],
      },
      // Phase 3 corridor tables (pilot values — BAK/VID to confirm).
      siTablesByRoute: {
        BEITBRIDGE: {
          DEFAULT: [8000, 9000, 9000],
          FLATBED: [8000, 9000, 9000],
          TANKER: [8000, 8000, 9000],
          REFRIGERATED: [7500, 9000, 9000],
          CONTAINER: [8000, 9000, 9000],
          DRY_VAN: [8000, 9000, 9000],
        },
        CHIRUNDU: {
          DEFAULT: [8000, 9000, 9000],
          FLATBED: [8000, 9000, 9000],
          TANKER: [8000, 8000, 9000],
          REFRIGERATED: [7500, 9000, 9000],
          CONTAINER: [8000, 9000, 9000],
          DRY_VAN: [8000, 9000, 9000],
        },
        FORBES: {
          DEFAULT: [8000, 9000, 9000],
          FLATBED: [8000, 9000, 9000],
          TANKER: [8000, 8000, 9000],
          REFRIGERATED: [7500, 9000, 9000],
          CONTAINER: [8000, 9000, 9000],
          DRY_VAN: [8000, 9000, 9000],
        },
        HARARE_LOCAL: {
          DEFAULT: [8000, 9000, 9000],
          FLATBED: [8000, 9000, 9000],
          TANKER: [8000, 8000, 9000],
          REFRIGERATED: [7500, 9000, 9000],
          CONTAINER: [8000, 9000, 9000],
          DRY_VAN: [8000, 9000, 9000],
        },
      },
      requiredChecklistItems: [
        { itemId: 'driver-license', label: 'Driver license verified', mandatory: true },
        { itemId: 'vehicle-reg', label: 'Vehicle registration verified', mandatory: true },
        { itemId: 'cargo-manifest', label: 'Cargo manifest attached', mandatory: true },
        { itemId: 'weight-cert', label: 'Weight certificate recorded', mandatory: true },
        { itemId: 'axle-calc', label: 'Axle load calculation within limits', mandatory: true },
      ],
      overridePolicy: { requiresSecondaryApproval: true, autoEscalateAfterMinutes: 30 },
    },
    { merge: true },
  )

  // Tafadzwa walkthrough shift — mirrors bak-logistics-app/src/lib/demoData.ts.
  const shiftQueue = [
    { id: 'q-seed-1', licensePlate: 'AEH 4521', driverName: 'T. Moyo', cargoType: 'Container', expectedDestination: 'Beitbridge', status: 'QUEUED' },
    { id: 'q-seed-2', licensePlate: 'AGX 9033', driverName: 'S. Ndlovu', cargoType: 'Dry van', expectedDestination: 'Forbes', status: 'ASSIGNED', assignedDockId: 'D1' },
    { id: 'q-seed-3', licensePlate: 'AFM 1187', driverName: 'K. Sibanda', cargoType: 'Tanker', expectedDestination: 'Chirundu', status: 'QUARANTINED' },
    { id: 'q-seed-4', licensePlate: 'ABZ 9901', driverName: 'R. Dube', cargoType: 'Container', expectedDestination: 'Beitbridge', status: 'QUEUED' },
    { id: 'q-seed-6', licensePlate: 'ADP 3357', driverName: 'J. Banda', cargoType: 'Flatbed', expectedDestination: 'Chirundu', status: 'PENDING_OVERRIDE' },
    { id: 'q-seed-7', licensePlate: 'AEW 7712', driverName: 'M. Hove', cargoType: 'Dry van', expectedDestination: 'Forbes', status: 'OVERRIDE_APPROVED' },
    { id: 'q-seed-8', licensePlate: 'AFX 6640', driverName: 'D. Mutasa', cargoType: 'Container', expectedDestination: 'Beitbridge', status: 'QUEUED' },
  ]
  for (const q of shiftQueue) {
    await db.doc(`facilities/${FACILITY}/queue/${q.id}`).set(
      { ...q, entryTimestamp: new Date(), createdAt: new Date() },
      { merge: true },
    )
  }

  const shiftAlerts = [
    { id: 'quar-q-seed-3', type: 'COMPLIANCE_FAILURE', severity: 'CRITICAL', status: 'ACTIVE', relatedEntityType: 'queueEntry', relatedEntityId: 'q-seed-3', message: 'AFM 1187 quarantined: Axle 2 overloaded by 1,400kg. Rebalancing or override required.' },
    { id: 'wait-q-seed-4', type: 'EXCESSIVE_WAIT', severity: 'HIGH', status: 'ACTIVE', relatedEntityType: 'queueEntry', relatedEntityId: 'q-seed-4', message: 'ABZ 9901 waiting 74m (exceeds 60m threshold).' },
  ]
  for (const a of shiftAlerts) {
    await db.doc(`facilities/${FACILITY}/alerts/${a.id}`).set(
      { ...a, escalationLevel: 0, triggeredAt: new Date(), createdAt: new Date() },
      { merge: true },
    )
  }

  console.log(`Seeded facility "${FACILITY}" (target: ${process.env.FIRESTORE_EMULATOR_HOST ?? 'live project'})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
