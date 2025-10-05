BEGIN;

-- Ensure ledger amounts are non-negative and track entry kind
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS entry_kind text;
UPDATE owa_ledger
SET entry_kind = CASE WHEN amount_cents < 0 THEN 'DEBIT' ELSE 'CREDIT' END,
    amount_cents = ABS(amount_cents)
WHERE entry_kind IS NULL;

ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS amount_value DECIMAL(18,2);
UPDATE owa_ledger SET amount_value = amount_cents::numeric / 100.0 WHERE amount_value IS NULL;

ALTER TABLE owa_ledger
  ALTER COLUMN entry_kind SET NOT NULL,
  ADD CONSTRAINT owa_ledger_entry_kind_chk CHECK (entry_kind IN ('DEBIT','CREDIT')),
  ADD CONSTRAINT owa_ledger_amount_nonneg CHECK (amount_cents >= 0);

ALTER TABLE owa_ledger ALTER COLUMN amount_value SET NOT NULL;
ALTER TABLE owa_ledger ADD CONSTRAINT owa_ledger_amount_value_nonneg CHECK (amount_value >= 0);

-- Period aggregates must stay non-negative
ALTER TABLE periods
  ADD CONSTRAINT periods_accrued_nonneg CHECK (accrued_cents >= 0),
  ADD CONSTRAINT periods_credited_nonneg CHECK (credited_to_owa_cents >= 0),
  ADD CONSTRAINT periods_final_liability_nonneg CHECK (final_liability_cents >= 0);

COMMIT;
