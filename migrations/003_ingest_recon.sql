-- 003_ingest_recon.sql
-- Event ingestion tables and reconciliation aggregates

CREATE TABLE IF NOT EXISTS payroll_events (
  id BIGSERIAL PRIMARY KEY,
  source_event_id TEXT NOT NULL,
  employer_abn TEXT NOT NULL,
  period_id TEXT NOT NULL,
  event_ts TIMESTAMPTZ NOT NULL,
  gross_total_cents BIGINT NOT NULL,
  withheld_total_cents BIGINT NOT NULL,
  expected_withholding_cents BIGINT NOT NULL,
  line_count INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_event_id)
);

CREATE INDEX IF NOT EXISTS payroll_events_period_idx
  ON payroll_events (employer_abn, period_id, event_ts);

CREATE TABLE IF NOT EXISTS pos_events (
  id BIGSERIAL PRIMARY KEY,
  source_event_id TEXT NOT NULL,
  merchant_abn TEXT NOT NULL,
  period_id TEXT NOT NULL,
  event_ts TIMESTAMPTZ NOT NULL,
  net_total_cents BIGINT NOT NULL,
  gst_total_cents BIGINT NOT NULL,
  expected_gst_cents BIGINT NOT NULL,
  line_count INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_event_id)
);

CREATE INDEX IF NOT EXISTS pos_events_period_idx
  ON pos_events (merchant_abn, period_id, event_ts);

CREATE TABLE IF NOT EXISTS recon_inputs (
  abn TEXT NOT NULL,
  period_id TEXT NOT NULL,
  paygw_expected_cents BIGINT NOT NULL DEFAULT 0,
  paygw_reported_cents BIGINT NOT NULL DEFAULT 0,
  gst_expected_cents BIGINT NOT NULL DEFAULT 0,
  gst_reported_cents BIGINT NOT NULL DEFAULT 0,
  payroll_event_count INTEGER NOT NULL DEFAULT 0,
  pos_event_count INTEGER NOT NULL DEFAULT 0,
  last_payroll_event_ts TIMESTAMPTZ,
  last_pos_event_ts TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (abn, period_id)
);
