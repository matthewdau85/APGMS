-- 003_payments_ledger_guards.sql
-- Harden the OWA ledger for payments service releases

-- Ensure gen_random_uuid is available for backfill
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Align receipt column naming if earlier migrations used bank_receipt_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'owa_ledger'
      AND column_name = 'bank_receipt_id'
  ) THEN
    ALTER TABLE owa_ledger RENAME COLUMN bank_receipt_id TO bank_receipt_hash;
  END IF;
END$$;

-- Add the release bookkeeping columns expected by the payments service
ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS rpt_verified boolean DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS release_uuid uuid,
  ADD COLUMN IF NOT EXISTS bank_receipt_hash text;

-- Backfill existing negative (release) rows so new constraints pass
UPDATE owa_ledger
SET rpt_verified = TRUE
WHERE amount_cents < 0 AND COALESCE(rpt_verified, FALSE) IS DISTINCT FROM TRUE;

UPDATE owa_ledger
SET release_uuid = COALESCE(release_uuid, gen_random_uuid())
WHERE amount_cents < 0;

-- Guardrail: any debit must correspond to a verified RPT + release UUID
ALTER TABLE owa_ledger DROP CONSTRAINT IF EXISTS owa_release_guard;
ALTER TABLE owa_ledger
  ADD CONSTRAINT owa_release_guard
  CHECK (amount_cents >= 0 OR (rpt_verified IS TRUE AND release_uuid IS NOT NULL));

-- Unique release UUID when present
CREATE UNIQUE INDEX IF NOT EXISTS owa_release_uuid_uidx
  ON owa_ledger (release_uuid)
  WHERE release_uuid IS NOT NULL;
