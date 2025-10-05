ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS stp_confirmation_id text;

CREATE INDEX IF NOT EXISTS idx_owa_stp_confirmation
  ON owa_ledger (stp_confirmation_id)
  WHERE stp_confirmation_id IS NOT NULL;
