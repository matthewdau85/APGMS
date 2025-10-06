-- 002_patent_extensions.sql

-- (A) OWA ledger: ensure idempotency + hash-chain columns and constraints
ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS prev_hash text,
  ADD COLUMN IF NOT EXISTS hash_after text,
  ADD COLUMN IF NOT EXISTS transfer_uuid uuid,
  ADD COLUMN IF NOT EXISTS bank_receipt_hash text;

-- Idempotency on the “real world receipt”
CREATE UNIQUE INDEX IF NOT EXISTS owa_uniq_bank_receipt
  ON owa_ledger (abn, tax_type, period_id, bank_receipt_hash)
  WHERE bank_receipt_hash IS NOT NULL;

-- Cheap lookup for hash chaining
CREATE INDEX IF NOT EXISTS owa_ledger_period_order_idx
  ON owa_ledger (abn, tax_type, period_id, id);

-- (B) RPT: canonical storage (you already added; keep for completeness)
ALTER TABLE rpt_tokens
  ADD COLUMN IF NOT EXISTS payload_c14n   text,
  ADD COLUMN IF NOT EXISTS payload_sha256 text,
  ADD COLUMN IF NOT EXISTS key_id         text,
  ADD COLUMN IF NOT EXISTS expires_at     timestamptz,
  ADD COLUMN IF NOT EXISTS nonce          text;

-- (C) State machine check (guardrails)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='periods_state_check') THEN
    ALTER TABLE periods ADD CONSTRAINT periods_state_check
    CHECK (state IN ('OPEN','CLOSING','READY_RPT','RELEASED','BLOCKED_ANOMALY','BLOCKED_DISCREPANCY'));
  END IF;
END$$;

-- (D) Helper view: period balances computed from the ledger
CREATE OR REPLACE VIEW v_period_balances AS
SELECT
  abn, tax_type, period_id,
  SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END)::bigint AS credited_cents,
  SUM(amount_cents)::bigint AS net_cents,
  MAX(id) AS last_ledger_id
FROM owa_ledger
GROUP BY abn, tax_type, period_id;

-- (E) Helper function: append to ledger with hash-chaining
CREATE OR REPLACE FUNCTION owa_append(
  p_abn text, p_tax text, p_period text,
  p_amount bigint,             -- +credit / -debit
  p_bank_receipt text          -- NULL for synthetic; string for idempotent real-world credit/debit
) RETURNS TABLE(id int, balance_after bigint, hash_after text) AS $$
DECLARE
  _prev_bal bigint := 0;
  _prev_hash text := '';
  _last record;
  _new_bal bigint;
  _hash text;
  _uuid uuid;
BEGIN
  -- idempotency: if the same receipt exists, return the existing row
  IF p_bank_receipt IS NOT NULL THEN
    SELECT * INTO _last
    FROM owa_ledger
    WHERE abn=p_abn AND tax_type=p_tax AND period_id=p_period
      AND bank_receipt_hash=p_bank_receipt
    LIMIT 1;

    IF FOUND THEN
      RETURN QUERY
      SELECT _last.id, _last.balance_after_cents, _last.hash_after;
      RETURN;
    END IF;
  END IF;

  -- previous tail
  SELECT balance_after_cents, hash_after
  INTO  _prev_bal, _prev_hash
  FROM owa_ledger
  WHERE abn=p_abn AND tax_type=p_tax AND period_id=p_period
  ORDER BY id DESC LIMIT 1;

  IF NOT FOUND THEN
    _prev_bal := 0; _prev_hash := '';
  END IF;

  _new_bal := _prev_bal + p_amount;

  -- chain hash = sha256(prev_hash || bank_receipt_hash || new_bal)
  _hash := encode(digest(coalesce(_prev_hash,'') || coalesce(p_bank_receipt,'') || _new_bal::text, 'sha256'),'hex');
  _uuid := gen_random_uuid();

  INSERT INTO owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after)
  VALUES (p_abn,p_tax,p_period,_uuid,p_amount,_new_bal,p_bank_receipt,_prev_hash,_hash)
  RETURNING id, balance_after_cents, hash_after
  INTO id, balance_after, hash_after;

  RETURN;
END; $$ LANGUAGE plpgsql;

-- (F) Helper to (re)compute totals into periods & keep CLOSING
CREATE OR REPLACE FUNCTION periods_sync_totals(p_abn text, p_tax text, p_period text)
RETURNS void AS $$
DECLARE
  _cred bigint := 0;
BEGIN
  SELECT credited_cents INTO _cred
  FROM v_period_balances
  WHERE abn=p_abn AND tax_type=p_tax AND period_id=p_period;

  UPDATE periods
  SET credited_to_owa_cents = COALESCE(_cred,0),
      final_liability_cents = COALESCE(_cred,0),
      state = CASE WHEN state='OPEN' OR state='CLOSING' THEN 'CLOSING' ELSE state END
  WHERE abn=p_abn AND tax_type=p_tax AND period_id=p_period;
END; $$ LANGUAGE plpgsql;
