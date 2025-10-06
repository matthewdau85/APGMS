-- 001_apgms_core.sql
CREATE TABLE IF NOT EXISTS periods (
  id SERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'OPEN',
  basis TEXT NOT NULL DEFAULT 'ACCRUAL',
  accrued_cents BIGINT NOT NULL DEFAULT 0,
  credited_to_owa_cents BIGINT NOT NULL DEFAULT 0,
  final_liability_cents BIGINT NOT NULL DEFAULT 0,
  merkle_root TEXT,
  running_balance_hash TEXT,
  anomaly_vector JSONB NOT NULL DEFAULT '{}'::JSONB,
  thresholds JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (abn, tax_type, period_id)
);

CREATE TABLE IF NOT EXISTS owa_ledger (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  transfer_uuid UUID NOT NULL,
  amount_cents BIGINT NOT NULL,
  balance_after_cents BIGINT NOT NULL,
  bank_receipt_hash TEXT,
  prev_hash TEXT,
  hash_after TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transfer_uuid),
  FOREIGN KEY (abn, tax_type, period_id)
    REFERENCES periods (abn, tax_type, period_id)
);

CREATE INDEX IF NOT EXISTS idx_owa_balance ON owa_ledger(abn, tax_type, period_id, id);

CREATE TABLE IF NOT EXISTS rpt_tokens (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  signature TEXT NOT NULL,
  payload_c14n TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ISSUED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (abn, tax_type, period_id, payload_sha256),
  FOREIGN KEY (abn, tax_type, period_id)
    REFERENCES periods (abn, tax_type, period_id)
);

CREATE TABLE IF NOT EXISTS bank_receipts (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  transfer_uuid UUID NOT NULL,
  bank_receipt_hash TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transfer_uuid),
  FOREIGN KEY (abn, tax_type, period_id)
    REFERENCES periods (abn, tax_type, period_id)
);

CREATE TABLE IF NOT EXISTS evidence_bundles (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  bundle JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (abn, tax_type, period_id),
  FOREIGN KEY (abn, tax_type, period_id)
    REFERENCES periods (abn, tax_type, period_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  prev_hash TEXT,
  terminal_hash TEXT NOT NULL
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
  request_hash TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome JSONB
);
