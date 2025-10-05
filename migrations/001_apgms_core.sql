-- 001_apgms_core.sql
-- Consolidated core schema for APGMS payments services.
-- Defines the canonical OWA ledger layout alongside supporting tables
-- used by the payments, reconciliation and reporting flows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS periods (
  id serial PRIMARY KEY,
  abn text NOT NULL,
  tax_type text NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id text NOT NULL,
  state text NOT NULL DEFAULT 'OPEN',
  basis text DEFAULT 'ACCRUAL',
  accrued_cents bigint DEFAULT 0,
  credited_to_owa_cents bigint DEFAULT 0,
  final_liability_cents bigint DEFAULT 0,
  merkle_root text,
  running_balance_hash text,
  anomaly_vector jsonb DEFAULT '{}',
  thresholds jsonb DEFAULT '{}',
  UNIQUE (abn, tax_type, period_id)
);

CREATE TABLE IF NOT EXISTS owa_ledger (
  id bigserial PRIMARY KEY,
  abn text NOT NULL,
  tax_type text NOT NULL CHECK (tax_type IN ('PAYGW','GST')),
  period_id text NOT NULL,
  transfer_uuid uuid NOT NULL DEFAULT gen_random_uuid(),
  amount_cents bigint NOT NULL,
  balance_after_cents bigint NOT NULL,
  bank_receipt_hash text,
  bank_receipt_id text,
  prev_hash text,
  hash_after text,
  rpt_verified boolean NOT NULL DEFAULT false,
  release_uuid uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Column backfills for hosts that created an early variant of the table.
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS transfer_uuid uuid;
ALTER TABLE owa_ledger ALTER COLUMN transfer_uuid SET NOT NULL;
ALTER TABLE owa_ledger ALTER COLUMN transfer_uuid SET DEFAULT gen_random_uuid();
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS bank_receipt_hash text;
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS bank_receipt_id text;
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS hash_after text;
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS rpt_verified boolean NOT NULL DEFAULT false;
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS release_uuid uuid;
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS balance_after_cents bigint;
ALTER TABLE owa_ledger ALTER COLUMN balance_after_cents SET NOT NULL;

-- Ensure sign discipline: negatives require an authorised release entry.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'owa_ledger'::regclass AND conname = 'chk_owa_deposit_or_release'
  ) THEN
    ALTER TABLE owa_ledger
      ADD CONSTRAINT chk_owa_deposit_or_release
      CHECK (amount_cents >= 0 OR (rpt_verified AND release_uuid IS NOT NULL));
  END IF;
END$$;

-- Unique identity constraints implemented as indexes for ease of backfills.
CREATE UNIQUE INDEX IF NOT EXISTS owa_ledger_transfer_uuid_key
  ON owa_ledger(transfer_uuid);

CREATE UNIQUE INDEX IF NOT EXISTS ux_owa_release_uuid
  ON owa_ledger(release_uuid)
  WHERE release_uuid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_owa_bank_receipt_hash
  ON owa_ledger(bank_receipt_hash)
  WHERE bank_receipt_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_owa_bank_receipt_id
  ON owa_ledger(bank_receipt_id)
  WHERE bank_receipt_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_owa_single_release_per_period
  ON owa_ledger(abn, tax_type, period_id)
  WHERE amount_cents < 0;

CREATE INDEX IF NOT EXISTS idx_owa_balance
  ON owa_ledger(abn, tax_type, period_id, id);

CREATE TABLE IF NOT EXISTS rpt_tokens (
  id bigserial PRIMARY KEY,
  abn text NOT NULL,
  tax_type text NOT NULL,
  period_id text NOT NULL,
  payload jsonb NOT NULL,
  signature text NOT NULL,
  status text NOT NULL DEFAULT 'ISSUED',
  payload_c14n text,
  payload_sha256 text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq bigserial PRIMARY KEY,
  ts timestamptz DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  payload_hash text NOT NULL,
  prev_hash text,
  terminal_hash text
);

CREATE TABLE IF NOT EXISTS remittance_destinations (
  id serial PRIMARY KEY,
  abn text NOT NULL,
  label text NOT NULL,
  rail text NOT NULL,
  reference text NOT NULL,
  account_bsb text,
  account_number text,
  UNIQUE (abn, rail, reference)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  last_status text,
  response_hash text
);

CREATE TABLE IF NOT EXISTS bas_gate_states (
  id serial PRIMARY KEY,
  period_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('OPEN','PENDING_CLOSE','RECONCILING','RPT_ISSUED','REMITTED','BLOCKED')),
  reason_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  hash_prev text,
  hash_this text,
  UNIQUE (period_id)
);

CREATE TABLE IF NOT EXISTS rpt_store (
  id bigserial PRIMARY KEY,
  period_id text NOT NULL,
  rpt_json jsonb NOT NULL,
  rpt_sig text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW v_period_balances AS
SELECT
  abn,
  tax_type,
  period_id,
  SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END)::bigint AS credited_cents,
  SUM(amount_cents)::bigint AS net_cents,
  MAX(id) AS last_ledger_id
FROM owa_ledger
GROUP BY abn, tax_type, period_id;

CREATE OR REPLACE VIEW owa_balance AS
SELECT
  tax_type,
  COALESCE(SUM(amount_cents), 0)::bigint AS balance
FROM owa_ledger
GROUP BY tax_type;
