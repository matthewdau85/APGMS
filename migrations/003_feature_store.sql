-- 003_feature_store.sql
-- Feature flag store and SoD approvals for admin mode changes

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  flag_key TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING',
  UNIQUE(request_id)
);

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS entry JSONB;
