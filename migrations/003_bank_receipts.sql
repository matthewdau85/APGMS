-- 003_bank_receipts.sql
-- Introduce bank receipt storage and link to ledger entries

CREATE TABLE IF NOT EXISTS bank_receipts (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  shadow_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_receipts_period_idx
  ON bank_receipts (abn, tax_type, period_id, id);

ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS rpt_verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS release_uuid UUID;

ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS bank_receipt_id BIGINT REFERENCES bank_receipts(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_release_requires_rpt'
      AND conrelid = 'owa_ledger'::regclass
  ) THEN
    ALTER TABLE owa_ledger
      ADD CONSTRAINT chk_release_requires_rpt
        CHECK (amount_cents >= 0 OR (rpt_verified AND release_uuid IS NOT NULL));
  END IF;
END;
$$;
