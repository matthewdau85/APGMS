-- 003_banking_extensions.sql
-- Banking receipts, ingestion inputs, and ledger enhancements

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS bank_receipts (
  receipt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  rail TEXT NOT NULL CHECK (rail IN ('BPAY','EFT','PAYTO_SWEEP')),
  amount_cents BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL,
  provider_reference TEXT,
  synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  shadow_only BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'SETTLED',
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (abn, tax_type, period_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS bank_receipts_period_idx
  ON bank_receipts (abn, tax_type, period_id);

ALTER TABLE remittance_destinations
  ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS rpt_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS release_uuid UUID,
  ADD COLUMN IF NOT EXISTS bank_receipt_id UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'owa_ledger_bank_receipt_fk'
  ) THEN
    ALTER TABLE owa_ledger
      ADD CONSTRAINT owa_ledger_bank_receipt_fk
      FOREIGN KEY (bank_receipt_id) REFERENCES bank_receipts(receipt_id);
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS ingest_events (
  event_id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('STP','POS')),
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  payload JSONB NOT NULL,
  hmac TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ingest_events_period_idx
  ON ingest_events (abn, tax_type, period_id, source);

CREATE TABLE IF NOT EXISTS recon_inputs (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('STP','POS')),
  total_cents BIGINT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (abn, tax_type, period_id, source)
);
