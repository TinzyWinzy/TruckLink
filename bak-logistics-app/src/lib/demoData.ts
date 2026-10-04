/**
 * Central the gatekeeper shift seed — one realistic morning board.
 * Single source of truth for demo mode (no Firebase config).
 * Firestore staging seed mirrors these values — see functions/src/seed.ts
 * and live.ts seedDemoFacility().
 *
 * Scenario: 06:00–10:00 shift, Beitbridge surge overnight, 8 trucks covering
 * every gate state the gatekeeper must recognise (QUEUED → RELEASED + quarantine path).
 */

export interface DemoQueueRow {
  id: string
  plate: string
  driver: string
  cargo: string
  dest: string
  rawStatus: string
  enteredAt: string
  note?: string
}

export const DEMO_QUEUE: DemoQueueRow[] = [
  { id: 'q1', plate: 'AEH 4521', driver: 'T. Moyo', cargo: 'Container', dest: 'Beitbridge', rawStatus: 'QUEUED', enteredAt: '08:12', note: 'Arrived in overnight surge — assign next' },
  { id: 'q2', plate: 'AGX 9033', driver: 'S. Ndlovu', cargo: 'Dry van', dest: 'Forbes', rawStatus: 'ASSIGNED', enteredAt: '08:40', note: 'On Dock 2, loading' },
  { id: 'q3', plate: 'AFM 1187', driver: 'K. Sibanda', cargo: 'Tanker', dest: 'Chirundu', rawStatus: 'QUARANTINED', enteredAt: '07:05', note: 'Axle 2 +1,400kg — rebalancing at Bay 4' },
  { id: 'q4', plate: 'ABZ 9901', driver: 'R. Dube', cargo: 'Container', dest: 'Beitbridge', rawStatus: 'QUEUED', enteredAt: '07:04', note: 'Waiting 74m — overdue, prioritise' },
  { id: 'q5', plate: 'AEO 2210', driver: 'P. Chikafu', cargo: 'Refrigerated', dest: 'Harare Local', rawStatus: 'RELEASED', enteredAt: '06:20', note: 'Blueberries — cleared 09:05, reefer temp OK' },
  { id: 'q6', plate: 'ADP 3357', driver: 'J. Banda', cargo: 'Flatbed', dest: 'Chirundu', rawStatus: 'PENDING_OVERRIDE', enteredAt: '07:48', note: 'Override requested — needs supervisor ≠ requester' },
  { id: 'q7', plate: 'AEW 7712', driver: 'M. Hove', cargo: 'Dry van', dest: 'Forbes', rawStatus: 'OVERRIDE_APPROVED', enteredAt: '06:55', note: 'Approved — release from Queue board' },
  { id: 'q8', plate: 'AFX 6640', driver: 'D. Mutasa', cargo: 'Container', dest: 'Beitbridge', rawStatus: 'QUEUED', enteredAt: '09:15', note: 'Newest arrival — register checklist next' },
]

export interface DemoDock {
  id: string
  label: string
  rawStatus: string
  occupant: string
  util: number
}

export const DEMO_DOCKS: DemoDock[] = [
  { id: 'D1', label: 'Dock 1 · Heavy', rawStatus: 'OCCUPIED', occupant: 'AGX 9033', util: 82 },
  { id: 'D2', label: 'Dock 2 · General', rawStatus: 'OCCUPIED', occupant: 'AEW 7712', util: 64 },
  { id: 'D3', label: 'Dock 3 · General', rawStatus: 'AVAILABLE', occupant: '', util: 35 },
  { id: 'D4', label: 'Dock 4 · Quarantine Bay', rawStatus: 'MAINTENANCE', occupant: 'AFM 1187 (rebalance)', util: 0 },
]

export interface DemoAlert {
  id: string
  type: string
  severity: string
  status: string
  message: string
  triggeredAt: string
  action: string
}

export const DEMO_ALERTS: DemoAlert[] = [
  { id: 'seed-1', type: 'QUARANTINE', severity: 'CRITICAL', status: 'ACTIVE', message: 'AFM 1187 quarantined: Axle 2 overloaded by 1,400kg. Rebalancing or override required.', triggeredAt: '08:19', action: 'Open Compliance → enter q3 → request override, or rebalance at Bay 4.' },
  { id: 'seed-2', type: 'EXCESSIVE_WAIT', severity: 'HIGH', status: 'ACTIVE', message: 'ABZ 9901 waiting 74m (exceeds 60m threshold).', triggeredAt: '08:19', action: 'Open Docks → tap Dock 3 to assign ABZ 9901 next.' },
  { id: 'seed-3', type: 'EQUIPMENT_SHORTAGE', severity: 'MEDIUM', status: 'ACKNOWLEDGED', message: 'Forklift FL-02 utilisation 87% — consider rebalancing.', triggeredAt: '07:55', action: 'No action — watch only.' },
  { id: 'seed-4', type: 'OVERRIDE_PENDING', severity: 'HIGH', status: 'ACTIVE', message: 'ADP 3357 override awaiting secondary approver (requester cannot self-approve).', triggeredAt: '08:02', action: 'Supervisor ≠ requester approves in Compliance → Quarantine override.' },
]

export interface DemoAudit {
  id: string
  action: string
  entityType: string
  entityId: string
  actor: string
  currentHash: string
  timestamp: string
}

export const DEMO_AUDIT: DemoAudit[] = [
  { id: 'seed-1', action: 'GATE_RELEASE', entityType: 'queueEntry', entityId: 'q5 (AEO 2210)', actor: 'the gatekeeper (DISPATCH)', currentHash: '9f2c…a41d', timestamp: '09:05' },
  { id: 'seed-2', action: 'OVERRIDE_APPROVE', entityType: 'complianceCheck', entityId: 'c-q7 (AEW 7712)', actor: 'Ops Supervisor', currentHash: '71be…03c9', timestamp: '08:47' },
  { id: 'seed-3', action: 'QUARANTINE', entityType: 'queueEntry', entityId: 'q3 (AFM 1187)', actor: 'System rule engine', currentHash: 'c44d…88f1', timestamp: '08:19' },
  { id: 'seed-4', action: 'DOCK_ASSIGN', entityType: 'queueEntry', entityId: 'q2 → D1 (AGX 9033)', actor: 'Ops Supervisor', currentHash: 'a1b2…77e0', timestamp: '08:41' },
]

export interface GuideStep {
  n: string
  title: string
  where: string
  to: string
  what: string
  done: string
  note: string
}

export const GUIDE_STEPS: GuideStep[] = [
  { n: '0', title: 'Sign in to your shift', where: 'Gate sign-in (/)', to: '/', what: 'Practice: pick DISPATCH_SUPERVISOR → Start shift. On the yard: Staff ID TRK-07-DEMO + 4–12 digit PIN.', done: 'You land on Shift queue.', note: 'Your Staff ID is TRK-07-DEMO. If PIN fails, check caps and try once more — then ask your supervisor.' },
  { n: '1', title: 'Register the truck in front of you', where: 'Shift queue (/queue)', to: '/queue', what: 'Type Plate + Driver + Cargo + Destination → + Register. Plate auto-uppercases; offline queues with ⏳ badge.', done: 'New row appears as ◆ QUEUED at the top.', note: 'Practice: register AFX 6640 again with driver D. Mutasa — then delete it mentally; the point is the motion.' },
  { n: '2', title: 'Run the 4-step pre-departure check', where: 'Pre-departure check (/compliance)', to: '/compliance', what: '1 Vehicle (route + type) → 2 Weights (Read from weighbridge or type) → 3 Checks (tick all REQUIRED) → 4 Validate. PASS enables release; FAIL quarantines + raises a CRITICAL alert.', done: 'Green PASS box or red FAIL + quarantine panel.', note: 'Try FAIL on purpose: set Axle 2 to 11000kg → Validate → see quarantine. Then reset to 8000kg.' },
  { n: '3', title: 'Assign a dock (supervisor covers)', where: 'Dock board (/docks)', to: '/docks', what: 'Tap a green AVAILABLE dock → oldest QUEUED truck assigns automatically. Needs signal.', done: 'Dock flips to ■ OCCUPIED with the plate on it.', note: 'As DISPATCH you can watch but not tap — ask Ops to show assigning ABZ 9901 → Dock 3.' },
  { n: '4', title: 'Work the quarantine path', where: 'Compliance → Quarantine override', to: '/compliance', what: 'Request override (reason required) → a DIFFERENT supervisor approves. Requester can never self-approve.', done: 'Status PENDING_OVERRIDE → OVERRIDE_APPROVED → releasable.', note: 'Find ADP 3357 (PENDING_OVERRIDE). Requester name ≠ approver name — that is the rule being tested.' },
  { n: '5', title: 'Clear alerts you own', where: 'Alerts (/alerts)', to: '/alerts', what: 'CRITICAL first. Acknowledge = "I own this problem". Escalation runs at 10 and 30 min.', done: 'ACTIVE → ACKNOWLEDGED; header critical count drops.', note: 'DISPATCH is read-only on Acknowledge — if the button is hidden, that is correct, not a bug.' },
  { n: '6', title: 'Release + read the numbers', where: 'Queue → Reports (/reports)', to: '/reports', what: 'Releasable rows (COMPLETED / OVERRIDE_APPROVED) show Release →. Reports shows Overdue, Waiting, Turnaround, Dock load + ↓ Export CSV for the manager.', done: 'Truck → RELEASED with exit stamp; CSV downloads.', note: 'Release AEW 7712 (OVERRIDE_APPROVED), then open Reports → Export CSV — that file is what the manager sends to clients.' },
]

export const SI_CARDS = [
  { title: 'S.I. 129/2015 + S.I. 159/2022', body: 'ZINARA/VID enforce USD $0.50 per excess kg. A 1,500kg mismatch ≈ $945 all-in (fine $750 + re-weigh $20 + RT16 $25 + storage $20/day + ~$150 decanting). 7 prevented overloads repay the $6,200 pilot.' },
  { title: 'Pilot axle limits (confirm with VID)', body: 'DEFAULT 8000 / 9000 / 9000 kg. TANKER axle 2: 8000. REFRIGERATED axle 1: 7500. Route tables: BEITBRIDGE · CHIRUNDU · FORBES · HARARE_LOCAL — your supervisor updates the rule book, no app update needed.' },
  { title: 'Offline rule', body: 'Queue + Compliance keep working offline and catch up later. Dock moves need signal. Header shows ● ONLINE / ■ OFFLINE + ⏳ queued count.' },
]

export const ROLE_CARDS = [
  { role: 'DISPATCH_SUPERVISOR', blurb: 'Gate: register + validate. Cannot assign docks, approve overrides, or acknowledge alerts.' },
  { role: 'OPERATIONS_SUPERVISOR', blurb: 'Yard: docks + overrides + acknowledge. the gatekeeper escalates here.' },
  { role: 'FACILITY_MANAGER', blurb: 'Oversight + release + reports + audit read.' },
  { role: 'EXECUTIVE', blurb: 'the manager: SLA reports + audit read. No yard writes.' },
  { role: 'COMPLIANCE_OFFICER', blurb: 'Audit-trail read only. Proves the chain.' },
  { role: 'ADMIN', blurb: 'Setup: prepares the yard + adds people (job + yard).' },
]
