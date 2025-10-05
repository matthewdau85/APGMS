-- 002_apgms_patent_core.sql
-- BAS Gate state machine and canonical OWA/RPT helpers aligned with per-period ledger

CREATE TABLE IF NOT EXISTS bas_gate_states (
  id SERIAL PRIMARY KEY,
  period_id VARCHAR(32) NOT NULL,
  state VARCHAR(20) NOT NULL CHECK (state IN ('Open','Pending-Close','Reconciling','RPT-Issued','Remitted','Blocked')),
  reason_code VARCHAR(64),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  hash_prev CHAR(64),
  hash_this CHAR(64)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_bas_gate_period ON bas_gate_states (period_id);

-- If a legacy aggregate-only ledger exists, park it so the canonical table can be created.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'owa_ledger'
      AND column_name = 'credit_amount'
  ) THEN
    ALTER TABLE owa_ledger RENAME TO owa_ledger_aggregate_legacy;
  END IF;
END $$;

-- Ensure the per-period ledger has the expected columns and guard rails.
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
  rpt_verified BOOLEAN NOT NULL DEFAULT false,
  release_uuid UUID,
  bank_receipt_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT owa_release_guard
    CHECK (
      amount_cents >= 0
      OR (amount_cents < 0 AND rpt_verified = true AND release_uuid IS NOT NULL)
    ),
  UNIQUE (transfer_uuid)
);

ALTER TABLE owa_ledger
  ALTER COLUMN balance_after_cents SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN rpt_verified SET NOT NULL;

ALTER TABLE owa_ledger
  ALTER COLUMN transfer_uuid SET DEFAULT gen_random_uuid();

ALTER TABLE owa_ledger
  ALTER COLUMN transfer_uuid SET NOT NULL;

ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS rpt_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS release_uuid UUID,
  ADD COLUMN IF NOT EXISTS bank_receipt_id TEXT,
  ADD COLUMN IF NOT EXISTS bank_receipt_hash TEXT,
  ADD COLUMN IF NOT EXISTS prev_hash TEXT,
  ADD COLUMN IF NOT EXISTS hash_after TEXT,
  ADD COLUMN IF NOT EXISTS balance_after_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transfer_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'owa_release_guard'
  ) THEN
    ALTER TABLE owa_ledger ADD CONSTRAINT owa_release_guard
      CHECK (
        amount_cents >= 0
        OR (amount_cents < 0 AND rpt_verified = true AND release_uuid IS NOT NULL)
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS owa_uniq_bank_receipt
  ON owa_ledger (abn, tax_type, period_id, bank_receipt_hash)
  WHERE bank_receipt_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS owa_release_uuid_uidx
  ON owa_ledger (release_uuid)
  WHERE release_uuid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS owa_single_release_uidx
  ON owa_ledger (abn, tax_type, period_id)
  WHERE amount_cents < 0;

CREATE INDEX IF NOT EXISTS owa_ledger_period_order_idx
  ON owa_ledger (abn, tax_type, period_id, id);

-- Audit log: rename legacy aggregate chain if encountered, otherwise ensure canonical structure.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_log'
      AND column_name = 'message'
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'audit_log'
          AND column_name = 'payload_hash'
      )
  ) THEN
    ALTER TABLE audit_log RENAME TO audit_log_legacy;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS audit_log (
  seq BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ DEFAULT now(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  prev_hash TEXT,
  terminal_hash TEXT
);

-- RPT tokens: retire duplicate store and ensure canonical columns exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rpt_store'
  ) THEN
    ALTER TABLE rpt_store RENAME TO rpt_store_legacy;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS rpt_tokens (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_c14n TEXT,
  payload_sha256 TEXT,
  signature TEXT NOT NULL,
  key_id TEXT,
  nonce TEXT,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'ISSUED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE rpt_tokens
  ADD COLUMN IF NOT EXISTS payload JSONB,
  ADD COLUMN IF NOT EXISTS payload_c14n TEXT,
  ADD COLUMN IF NOT EXISTS payload_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS key_id TEXT,
  ADD COLUMN IF NOT EXISTS nonce TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ISSUED';

ALTER TABLE rpt_tokens
  ALTER COLUMN payload SET NOT NULL,
  ALTER COLUMN signature SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'ISSUED';

CREATE INDEX IF NOT EXISTS rpt_tokens_lookup_idx
  ON rpt_tokens (abn, tax_type, period_id, status);

-- Canonical balance view keyed by period.
DROP VIEW IF EXISTS owa_balance;
CREATE VIEW owa_balance AS
SELECT
  abn,
  tax_type,
  period_id,
  COALESCE(SUM(amount_cents), 0)::bigint AS balance_cents,
  MAX(id) AS last_entry_id
FROM owa_ledger
GROUP BY abn, tax_type, period_id;
