-- 004_tax_engine_pipeline.sql
-- Real tax-engine pipeline storage for normalized events and evidence hashes.

CREATE TABLE IF NOT EXISTS tax_event_results (
  event_id TEXT PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id TEXT NOT NULL,
  rates_version TEXT NOT NULL,
  gross_cents BIGINT NOT NULL DEFAULT 0,
  taxable_cents BIGINT NOT NULL DEFAULT 0,
  liability_cents BIGINT NOT NULL,
  event_payload JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tax_event_results_period_idx
  ON tax_event_results (abn, tax_type, period_id);

CREATE TABLE IF NOT EXISTS period_tax_totals (
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id TEXT NOT NULL,
  rates_version TEXT NOT NULL,
  gross_cents BIGINT NOT NULL DEFAULT 0,
  taxable_cents BIGINT NOT NULL DEFAULT 0,
  liability_cents BIGINT NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  evidence_payload JSONB,
  evidence_sha256 TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (abn, tax_type, period_id)
);

CREATE INDEX IF NOT EXISTS period_tax_totals_rates_idx
  ON period_tax_totals (rates_version);

ALTER TABLE periods
  ADD COLUMN IF NOT EXISTS evidence_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS last_rates_version TEXT;

CREATE OR REPLACE FUNCTION period_tax_totals_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS period_tax_totals_touch_trg ON period_tax_totals;
CREATE TRIGGER period_tax_totals_touch_trg
BEFORE UPDATE ON period_tax_totals
FOR EACH ROW EXECUTE FUNCTION period_tax_totals_touch();
