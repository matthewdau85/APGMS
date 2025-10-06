-- 003_core_updates.sql

ALTER TABLE periods
  ADD COLUMN IF NOT EXISTS rates_version text;

CREATE TABLE IF NOT EXISTS bank_receipts (
  id serial PRIMARY KEY,
  abn text NOT NULL,
  tax_type text NOT NULL,
  period_id text NOT NULL,
  provider_ref text NOT NULL,
  dry_run boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS rpt_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS release_uuid uuid,
  ADD COLUMN IF NOT EXISTS bank_receipt_id integer REFERENCES bank_receipts(id);

ALTER TABLE rpt_tokens
  ADD COLUMN IF NOT EXISTS payload_c14n text,
  ADD COLUMN IF NOT EXISTS payload_sha256 text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS rates_version text,
  ADD COLUMN IF NOT EXISTS nonce text;

ALTER TABLE rpt_tokens
  ALTER COLUMN status SET DEFAULT 'pending';
