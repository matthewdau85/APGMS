-- 001_init.sql
-- Baseline schema: ledger, BAS periods, audit log, and support tables

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS periods (
  id SERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'OPEN',
  basis TEXT DEFAULT 'ACCRUAL',
  accrued_cents BIGINT DEFAULT 0,
  credited_to_owa_cents BIGINT DEFAULT 0,
  final_liability_cents BIGINT DEFAULT 0,
  merkle_root TEXT,
  running_balance_hash TEXT,
  anomaly_vector JSONB DEFAULT '{}'::jsonb,
  thresholds JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (abn, tax_type, period_id)
);

CREATE TABLE IF NOT EXISTS owa_ledger (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  transfer_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  amount_cents BIGINT NOT NULL,
  balance_after_cents BIGINT NOT NULL,
  bank_receipt_hash TEXT,
  prev_hash TEXT,
  hash_after TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transfer_uuid)
);

CREATE INDEX IF NOT EXISTS idx_owa_ledger_period
  ON owa_ledger (abn, tax_type, period_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS owa_uniq_bank_receipt
  ON owa_ledger (abn, tax_type, period_id, bank_receipt_hash)
  WHERE bank_receipt_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS rpt_tokens (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  signature TEXT NOT NULL,
  payload_c14n TEXT,
  payload_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'ISSUED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rpt_store (
  id BIGSERIAL PRIMARY KEY,
  period_id TEXT NOT NULL,
  rpt_json JSONB NOT NULL,
  rpt_sig TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq BIGSERIAL PRIMARY KEY,
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT,
  action TEXT,
  payload_hash TEXT,
  prev_hash TEXT,
  terminal_hash TEXT,
  category TEXT,
  message TEXT,
  hash_prev TEXT,
  hash_this TEXT
);

CREATE TABLE IF NOT EXISTS remittance_destinations (
  id SERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  label TEXT NOT NULL,
  rail TEXT NOT NULL,
  reference TEXT NOT NULL,
  account_bsb TEXT,
  account_number TEXT,
  UNIQUE (abn, rail, reference)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_status TEXT,
  response_hash TEXT
);

CREATE OR REPLACE VIEW v_period_balances AS
SELECT
  abn,
  tax_type,
  period_id,
  SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END)::BIGINT AS credited_cents,
  SUM(amount_cents)::BIGINT AS net_cents,
  MAX(id) AS last_ledger_id
FROM owa_ledger
GROUP BY abn, tax_type, period_id;

CREATE OR REPLACE FUNCTION owa_append(
  p_abn TEXT,
  p_tax TEXT,
  p_period TEXT,
  p_amount BIGINT,
  p_bank_receipt TEXT
) RETURNS TABLE(id BIGINT, balance_after BIGINT, hash_after TEXT) AS $$
DECLARE
  _prev_bal BIGINT := 0;
  _prev_hash TEXT := '';
  _existing owa_ledger%ROWTYPE;
  _new_bal BIGINT;
  _hash TEXT;
BEGIN
  IF p_bank_receipt IS NOT NULL THEN
    SELECT * INTO _existing
    FROM owa_ledger
    WHERE abn = p_abn AND tax_type = p_tax AND period_id = p_period
      AND bank_receipt_hash = p_bank_receipt
    ORDER BY id DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN QUERY
      SELECT _existing.id, _existing.balance_after_cents, _existing.hash_after;
      RETURN;
    END IF;
  END IF;

  SELECT balance_after_cents, hash_after
    INTO _prev_bal, _prev_hash
  FROM owa_ledger
  WHERE abn = p_abn AND tax_type = p_tax AND period_id = p_period
  ORDER BY id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    _prev_bal := 0;
    _prev_hash := '';
  END IF;

  _new_bal := _prev_bal + p_amount;
  _hash := encode(digest(coalesce(_prev_hash, '') || coalesce(p_bank_receipt, '') || _new_bal::TEXT, 'sha256'), 'hex');

  INSERT INTO owa_ledger(
    abn,
    tax_type,
    period_id,
    transfer_uuid,
    amount_cents,
    balance_after_cents,
    bank_receipt_hash,
    prev_hash,
    hash_after
  )
  VALUES (
    p_abn,
    p_tax,
    p_period,
    gen_random_uuid(),
    p_amount,
    _new_bal,
    p_bank_receipt,
    _prev_hash,
    _hash
  )
  RETURNING id, balance_after_cents, hash_after
  INTO id, balance_after, hash_after;

  RETURN;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION periods_sync_totals(
  p_abn TEXT,
  p_tax TEXT,
  p_period TEXT
) RETURNS VOID AS $$
DECLARE
  _cred BIGINT := 0;
BEGIN
  SELECT credited_cents INTO _cred
  FROM v_period_balances
  WHERE abn = p_abn AND tax_type = p_tax AND period_id = p_period;

  UPDATE periods
  SET credited_to_owa_cents = COALESCE(_cred, 0),
      final_liability_cents = COALESCE(_cred, 0)
  WHERE abn = p_abn AND tax_type = p_tax AND period_id = p_period;
END;
$$ LANGUAGE plpgsql;
