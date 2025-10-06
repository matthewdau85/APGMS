BEGIN;

ALTER TABLE periods
  ALTER COLUMN state SET NOT NULL,
  ALTER COLUMN abn SET NOT NULL,
  ALTER COLUMN tax_type SET NOT NULL,
  ALTER COLUMN period_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'periods_abn_tax_type_period_id_key'
      AND table_name = 'periods'
  ) THEN
    ALTER TABLE periods
      ADD CONSTRAINT periods_abn_tax_type_period_id_key UNIQUE (abn, tax_type, period_id);
  END IF;
END$$;

ALTER TABLE owa_ledger
  ALTER COLUMN abn SET NOT NULL,
  ALTER COLUMN tax_type SET NOT NULL,
  ALTER COLUMN period_id SET NOT NULL,
  ALTER COLUMN transfer_uuid SET NOT NULL,
  ALTER COLUMN amount_cents SET NOT NULL,
  ALTER COLUMN balance_after_cents SET NOT NULL;

UPDATE owa_ledger SET bank_receipt_hash = COALESCE(bank_receipt_hash, '');
ALTER TABLE owa_ledger
  ALTER COLUMN bank_receipt_hash SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'owa_ledger_period_fk'
      AND table_name = 'owa_ledger'
  ) THEN
    ALTER TABLE owa_ledger
      ADD CONSTRAINT owa_ledger_period_fk
      FOREIGN KEY (abn, tax_type, period_id)
      REFERENCES periods (abn, tax_type, period_id)
      ON DELETE CASCADE;
  END IF;
END$$;

ALTER TABLE rpt_tokens
  ALTER COLUMN abn SET NOT NULL,
  ALTER COLUMN tax_type SET NOT NULL,
  ALTER COLUMN period_id SET NOT NULL,
  ALTER COLUMN payload SET NOT NULL,
  ALTER COLUMN signature SET NOT NULL;

ALTER TABLE rpt_tokens
  ADD COLUMN IF NOT EXISTS payload_c14n TEXT,
  ADD COLUMN IF NOT EXISTS payload_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS nonce TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE rpt_tokens
  SET payload_c14n = COALESCE(payload_c14n, payload::text),
      payload_sha256 = COALESCE(payload_sha256, 'legacy-' || id::text),
      nonce = COALESCE(nonce, 'legacy-' || id::text),
      expires_at = COALESCE(expires_at, now());

ALTER TABLE rpt_tokens
  ALTER COLUMN payload_c14n SET NOT NULL,
  ALTER COLUMN payload_sha256 SET NOT NULL,
  ALTER COLUMN nonce SET NOT NULL,
  ALTER COLUMN expires_at SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'rpt_tokens_period_nonce_key'
      AND table_name = 'rpt_tokens'
  ) THEN
    ALTER TABLE rpt_tokens
      ADD CONSTRAINT rpt_tokens_period_nonce_key
      UNIQUE (abn, tax_type, period_id, nonce);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'rpt_tokens_period_fk'
      AND table_name = 'rpt_tokens'
  ) THEN
    ALTER TABLE rpt_tokens
      ADD CONSTRAINT rpt_tokens_period_fk
      FOREIGN KEY (abn, tax_type, period_id)
      REFERENCES periods (abn, tax_type, period_id)
      ON DELETE CASCADE;
  END IF;
END$$;

ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS request_hash TEXT,
  ADD COLUMN IF NOT EXISTS response_status INTEGER,
  ADD COLUMN IF NOT EXISTS response_body JSONB,
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE idempotency_keys
  SET request_hash = COALESCE(request_hash, key),
      outcome = COALESCE(outcome, 'INIT');

UPDATE rpt_tokens SET status = COALESCE(status, 'active');

ALTER TABLE idempotency_keys
  ALTER COLUMN scope SET NOT NULL,
  ALTER COLUMN request_hash SET NOT NULL;

ALTER TABLE idempotency_keys
  DROP COLUMN IF EXISTS last_status,
  DROP COLUMN IF EXISTS response_hash;

CREATE TABLE IF NOT EXISTS bank_receipts (
  receipt_hash TEXT PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  raw jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bank_receipts_period_fk
    FOREIGN KEY (abn, tax_type, period_id)
    REFERENCES periods (abn, tax_type, period_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS evidence_bundles (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  bundle JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT evidence_bundles_period_fk
    FOREIGN KEY (abn, tax_type, period_id)
    REFERENCES periods (abn, tax_type, period_id)
    ON DELETE CASCADE
);

COMMIT;
