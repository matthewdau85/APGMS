-- 003_recon_inputs.sql
-- Recon input snapshots and reconciliation result history

CREATE TABLE IF NOT EXISTS recon_inputs (
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id TEXT NOT NULL,
  expected_cents BIGINT NOT NULL,
  tolerance_cents BIGINT NOT NULL,
  actual_cents BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (abn, tax_type, period_id)
);

CREATE TABLE IF NOT EXISTS recon_results (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id TEXT NOT NULL,
  expected_cents BIGINT NOT NULL,
  actual_cents BIGINT NOT NULL,
  delta_cents BIGINT NOT NULL,
  tolerance_cents BIGINT NOT NULL,
  tolerance_bps INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OK','FAIL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recon_results_period_idx
  ON recon_results (abn, tax_type, period_id, created_at DESC);
