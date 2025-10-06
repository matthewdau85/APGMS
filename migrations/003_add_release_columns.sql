-- 003_add_release_columns.sql
-- Adds release tracking fields required by the payments release handler

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS rpt_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS release_uuid UUID,
  ADD COLUMN IF NOT EXISTS bank_receipt_id TEXT;

-- Backfill historical release rows so the new columns satisfy constraints
UPDATE owa_ledger
SET rpt_verified = TRUE
WHERE amount_cents < 0 AND (rpt_verified IS NULL OR rpt_verified = FALSE);

UPDATE owa_ledger
SET release_uuid = gen_random_uuid()
WHERE amount_cents < 0 AND release_uuid IS NULL;
