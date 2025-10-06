-- 001_apgms_core.sql
CREATE TABLE IF NOT EXISTS periods (
  id SERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'OPEN',
  basis TEXT DEFAULT 'ACCRUAL',
  accrued_cents BIGINT DEFAULT 0,
  credited_to_owa_cents BIGINT DEFAULT 0,
  final_liability_cents BIGINT DEFAULT 0,
  merkle_root TEXT,
  running_balance_hash TEXT,
  anomaly_vector JSONB DEFAULT '{}'::jsonb,
  thresholds JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (abn, tax_type, period_id)
);

CREATE TABLE IF NOT EXISTS period_transitions (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (abn, tax_type, period_id)
    REFERENCES periods(abn, tax_type, period_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_period_transitions_period
  ON period_transitions(abn, tax_type, period_id, created_at);

CREATE TABLE IF NOT EXISTS owa_ledger (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id TEXT NOT NULL,
  transfer_uuid UUID NOT NULL,
  amount_cents BIGINT NOT NULL,
  balance_after_cents BIGINT NOT NULL,
  bank_receipt_hash TEXT,
  prev_hash TEXT,
  hash_after TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (transfer_uuid),
  FOREIGN KEY (abn, tax_type, period_id)
    REFERENCES periods(abn, tax_type, period_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_owa_period_order
  ON owa_ledger(abn, tax_type, period_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_owa_receipt
  ON owa_ledger(abn, tax_type, period_id, bank_receipt_hash)
  WHERE bank_receipt_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS rpt_tokens (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  signature TEXT NOT NULL,
  payload_c14n TEXT,
  payload_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'ISSUED',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (abn, tax_type, period_id)
    REFERENCES periods(abn, tax_type, period_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rpt_period
  ON rpt_tokens(abn, tax_type, period_id, id DESC);

CREATE TABLE IF NOT EXISTS payroll_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  gross_cents BIGINT,
  withheld_cents BIGINT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source, event_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_period
  ON payroll_events(abn, period_id, occurred_at);

CREATE TABLE IF NOT EXISTS pos_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  abn TEXT NOT NULL,
  period_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  total_cents BIGINT,
  gst_cents BIGINT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source, event_id)
);
CREATE INDEX IF NOT EXISTS idx_pos_period
  ON pos_events(abn, period_id, occurred_at);

CREATE TABLE IF NOT EXISTS ingestion_dlq (
  id BIGSERIAL PRIMARY KEY,
  source_system TEXT NOT NULL,
  event_id TEXT,
  payload JSONB,
  error_message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ DEFAULT NOW(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  prev_hash TEXT,
  terminal_hash TEXT
);

CREATE TABLE IF NOT EXISTS remittance_destinations (
  id SERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  label TEXT NOT NULL,
  rail TEXT NOT NULL,
  reference TEXT NOT NULL,
  account_bsb TEXT,
  account_number TEXT,
  UNIQUE (abn, rail, reference)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_status TEXT,
  response_hash TEXT
);
