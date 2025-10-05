-- 003_security_security.sql
-- Security configuration state and audit detail storage

CREATE TABLE IF NOT EXISTS security_settings (
  tenant_id TEXT PRIMARY KEY,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  encryption_enforced BOOLEAN NOT NULL DEFAULT FALSE,
  transport_key TEXT NOT NULL,
  mfa_secret TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_audit_events (
  audit_seq BIGINT PRIMARY KEY REFERENCES audit_log(seq) ON DELETE CASCADE,
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload JSONB NOT NULL
);
