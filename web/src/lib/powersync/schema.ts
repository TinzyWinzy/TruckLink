import { column, Schema, Table } from '@powersync/web'

export const facilitiesTable = new Table({
  name: column.text,
  created_at: column.text
})

export const usersTable = new Table({
  email: column.text,
  role: column.text,
  facility_id: column.text,
  name: column.text
})

export const queueEntriesTable = new Table({
  facility_id: column.text,
  reg_number: column.text,
  driver_name: column.text,
  haulier: column.text,
  vehicle_type: column.text,
  cargo_type: column.text,
  status: column.text, // QUEUED, AT_DOCK, COMPLETED, QUARANTINED, RELEASED
  assigned_dock_id: column.text,
  entry_timestamp: column.text,
  exit_timestamp: column.text,
  dwell_duration_seconds: column.integer,
  created_at: column.text,
  updated_at: column.text
})

export const docksTable = new Table({
  facility_id: column.text,
  name: column.text,
  status: column.text, // AVAILABLE, OCCUPIED, MAINTENANCE
  current_vehicle_id: column.text,
  updated_at: column.text
})

export const complianceChecksTable = new Table({
  facility_id: column.text,
  queue_id: column.text,
  reg_number: column.text,
  vehicle_type: column.text,
  route_type: column.text,
  axle_weights: column.text, // JSON stringified array of weights
  measured_total_kg: column.integer,
  max_permissible_kg: column.integer,
  overload_kg: column.integer,
  overload_fee_usd: column.real,
  checklist_results: column.text, // JSON stringified checklist map
  status: column.text, // PASSED, QUARANTINED, PENDING_OVERRIDE, OVERRIDE_APPROVED
  inspector_id: column.text,
  timestamp: column.text,
  override_reason: column.text,
  override_authorizer_id: column.text
})

export const auditLogsTable = new Table({
  facility_id: column.text,
  action: column.text,
  payload: column.text, // JSON stringified payload
  actor_id: column.text,
  timestamp: column.text,
  previous_hash: column.text,
  hash: column.text
})

export const alertsTable = new Table({
  facility_id: column.text,
  severity: column.text, // CRITICAL, HIGH, MEDIUM, LOW
  message: column.text,
  category: column.text,
  acknowledged: column.integer, // 0 or 1 for SQLite
  acknowledged_by: column.text,
  timestamp: column.text
})

export const equipmentTable = new Table({
  facility_id: column.text,
  name: column.text,
  type: column.text,
  status: column.text,
  updated_at: column.text
})

export const AppSchema = new Schema({
  facilities: facilitiesTable,
  users: usersTable,
  queue_entries: queueEntriesTable,
  docks: docksTable,
  compliance_checks: complianceChecksTable,
  audit_logs: auditLogsTable,
  alerts: alertsTable,
  equipment: equipmentTable
})

export type Database = (typeof AppSchema)['types']
