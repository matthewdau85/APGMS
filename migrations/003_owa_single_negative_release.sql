-- 003_owa_single_negative_release.sql
-- Ensure only one negative (release) entry exists per ABN/tax_type/period_id.
CREATE UNIQUE INDEX IF NOT EXISTS ux_owa_single_negative_release
  ON owa_ledger (abn, tax_type, period_id)
  WHERE amount_cents < 0;
