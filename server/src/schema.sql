-- BAK OpShield PostgreSQL Schema for PowerSync

CREATE TABLE IF NOT EXISTS facilities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL,
    facility_id TEXT REFERENCES facilities(id),
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_entries (
    id TEXT PRIMARY KEY,
    facility_id TEXT NOT NULL REFERENCES facilities(id),
    reg_number TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    haulier TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    cargo_type TEXT NOT NULL,
    status TEXT NOT NULL, -- QUEUED, AT_DOCK, COMPLETED, QUARANTINED, RELEASED
    assigned_dock_id TEXT,
    entry_timestamp TIMESTAMPTZ NOT NULL,
    exit_timestamp TIMESTAMPTZ,
    dwell_duration_seconds INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS docks (
    id TEXT PRIMARY KEY,
    facility_id TEXT NOT NULL REFERENCES facilities(id),
    name TEXT NOT NULL,
    status TEXT NOT NULL, -- AVAILABLE, OCCUPIED, MAINTENANCE
    current_vehicle_id TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_checks (
    id TEXT PRIMARY KEY,
    facility_id TEXT NOT NULL REFERENCES facilities(id),
    queue_id TEXT NOT NULL,
    reg_number TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    route_type TEXT NOT NULL,
    axle_weights JSONB NOT NULL,
    measured_total_kg INTEGER NOT NULL,
    max_permissible_kg INTEGER NOT NULL,
    overload_kg INTEGER NOT NULL,
    overload_fee_usd NUMERIC(10, 2) NOT NULL,
    checklist_results JSONB NOT NULL,
    status TEXT NOT NULL, -- PASSED, QUARANTINED, PENDING_OVERRIDE, OVERRIDE_APPROVED
    inspector_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    override_reason TEXT,
    override_authorizer_id TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    facility_id TEXT NOT NULL REFERENCES facilities(id),
    action TEXT NOT NULL,
    payload JSONB NOT NULL,
    actor_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    previous_hash TEXT NOT NULL,
    hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    facility_id TEXT NOT NULL REFERENCES facilities(id),
    severity TEXT NOT NULL, -- CRITICAL, HIGH, MEDIUM, LOW
    message TEXT NOT NULL,
    category TEXT NOT NULL,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by TEXT,
    timestamp TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS equipment (
    id TEXT PRIMARY KEY,
    facility_id TEXT NOT NULL REFERENCES facilities(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for high-velocity queries
CREATE INDEX IF NOT EXISTS idx_queue_facility_status ON queue_entries(facility_id, status);
CREATE INDEX IF NOT EXISTS idx_docks_facility ON docks(facility_id);
CREATE INDEX IF NOT EXISTS idx_compliance_facility ON compliance_checks(facility_id);
CREATE INDEX IF NOT EXISTS idx_audit_facility_time ON audit_logs(facility_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_facility_ack ON alerts(facility_id, acknowledged);

-- Phase 4 async orchestration: transactional outbox.
-- Domain writes + events commit atomically; a relay publishes to RabbitMQ
-- after COMMIT. Rows stay pending when the broker is down (pilot-safe).
CREATE TABLE IF NOT EXISTS outbox_events (
    id TEXT PRIMARY KEY,
    exchange TEXT NOT NULL,
    routing_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(dispatched_at, created_at);

-- Phase 5 billing confirmation loop: ERP acknowledges receipt of the gate
-- ticket; idempotent on (queue_entry_id, erp_reference).
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS billed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE queue_entries ADD COLUMN IF NOT EXISTS erp_reference TEXT;
CREATE INDEX IF NOT EXISTS idx_queue_billed ON queue_entries(facility_id, billed);

-- $0 notifications: FCM device tokens per user. One row per (user, token).
-- role is denormalized from the tablet at subscribe time (users live in Firebase).
CREATE TABLE IF NOT EXISTS push_subscriptions (
    user_id TEXT NOT NULL,
    facility_id TEXT NOT NULL REFERENCES facilities(id),
    role TEXT NOT NULL DEFAULT 'DISPATCH_SUPERVISOR',
    fcm_token TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, fcm_token)
);
CREATE INDEX IF NOT EXISTS idx_push_facility ON push_subscriptions(facility_id);
CREATE INDEX IF NOT EXISTS idx_push_role ON push_subscriptions(facility_id, role);
