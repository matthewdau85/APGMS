-- 003_shadow_mode.sql
-- Shadow observations table for dual-call monitoring

CREATE TABLE IF NOT EXISTS shadow_observations (
  id BIGSERIAL PRIMARY KEY,
  trace_id UUID NOT NULL,
  operation TEXT NOT NULL,
  mock_status INTEGER,
  real_status INTEGER,
  mock_body JSONB,
  real_body JSONB,
  mock_latency_ms NUMERIC,
  real_latency_ms NUMERIC,
  latency_delta_ms NUMERIC,
  status_mismatch BOOLEAN DEFAULT FALSE,
  body_mismatch BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shadow_observations_created_at ON shadow_observations(created_at);
CREATE INDEX IF NOT EXISTS idx_shadow_observations_operation ON shadow_observations(operation);
