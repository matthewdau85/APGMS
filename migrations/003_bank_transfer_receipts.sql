-- 003_bank_transfer_receipts.sql
CREATE TABLE IF NOT EXISTS bank_transfer_receipts (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT,
  tax_type TEXT,
  period_id TEXT,
  rail TEXT NOT NULL,
  reference TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  provider_receipt_id TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_receipts_provider
  ON bank_transfer_receipts (provider_receipt_id);

CREATE INDEX IF NOT EXISTS ix_bank_receipts_period
  ON bank_transfer_receipts (abn, tax_type, period_id);
