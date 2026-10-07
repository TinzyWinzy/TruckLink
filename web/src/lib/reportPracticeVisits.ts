import type { LiveRow } from './live'

// Original synthetic visit export fixtures; never a live-data fallback.
export const practiceVisits: LiveRow[] = [
  { id: 'q1', licensePlate: 'AEH 4521', driverName: 'T. Moyo', cargoType: 'Container', expectedDestination: 'Beitbridge', status: 'QUEUED', entryTimestamp: new Date(Date.now() - 42 * 60000).toISOString() },
  { id: 'q2', licensePlate: 'AGX 9033', driverName: 'S. Ndlovu', cargoType: 'Dry van', expectedDestination: 'Forbes', status: 'ASSIGNED', entryTimestamp: new Date(Date.now() - 25 * 60000).toISOString() },
  { id: 'q3', licensePlate: 'AFM 1187', driverName: 'K. Sibanda', cargoType: 'Tanker', expectedDestination: 'Chirundu', status: 'QUARANTINED', entryTimestamp: new Date(Date.now() - 169 * 60000).toISOString() },
  { id: 'q4', licensePlate: 'ABZ 9901', driverName: 'R. Dube', cargoType: 'Container', expectedDestination: 'Beitbridge', status: 'QUEUED', entryTimestamp: new Date(Date.now() - 74 * 60000).toISOString() },
  { id: 'q5', licensePlate: 'AEO 2210', driverName: 'P. Chikafu', cargoType: 'Refrigerated', expectedDestination: 'Harare Local', status: 'RELEASED', entryTimestamp: new Date(Date.now() - 180 * 60000).toISOString(), exitTimestamp: new Date(Date.now() - 95 * 60000).toISOString() },
  { id: 'q6', licensePlate: 'ADP 3357', driverName: 'J. Banda', cargoType: 'Flatbed', expectedDestination: 'Chirundu', status: 'PENDING_OVERRIDE', entryTimestamp: new Date(Date.now() - 86 * 60000).toISOString() },
  { id: 'q7', licensePlate: 'AEW 7712', driverName: 'M. Hove', cargoType: 'Dry van', expectedDestination: 'Forbes', status: 'OVERRIDE_APPROVED', entryTimestamp: new Date(Date.now() - 139 * 60000).toISOString() },
  { id: 'q8', licensePlate: 'AFX 6640', driverName: 'D. Mutasa', cargoType: 'Container', expectedDestination: 'Beitbridge', status: 'QUEUED', entryTimestamp: new Date(Date.now() - 9 * 60000).toISOString() },
]
