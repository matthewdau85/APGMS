-- 003_real_rails.sql
BEGIN;

CREATE TABLE IF NOT EXISTS bank_receipts (
  id UUID PRIMARY KEY,
  channel TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta JSONB NOT NULL DEFAULT '{}',
  dry_run BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS rpt_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS release_uuid UUID,
  ADD COLUMN IF NOT EXISTS release_receipt_id UUID REFERENCES bank_receipts(id);

CREATE INDEX IF NOT EXISTS ix_bank_receipts_provider_ref
  ON bank_receipts (provider_ref);

CREATE TABLE IF NOT EXISTS bank_recon_imports (
  id UUID PRIMARY KEY,
  raw_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY,
  abn TEXT NOT NULL,
  period_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL,
  provider_ref TEXT NOT NULL,
  raw_ref JSONB NOT NULL DEFAULT '{}',
  bank_receipt_id UUID REFERENCES bank_receipts(id),
  import_id UUID REFERENCES bank_recon_imports(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE evidence_bundles
  ADD COLUMN IF NOT EXISTS settlement JSONB,
  ADD COLUMN IF NOT EXISTS bank_receipt_id UUID;

COMMIT;
