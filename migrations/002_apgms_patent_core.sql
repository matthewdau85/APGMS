-- 002_apgms_patent_core.sql
-- BAS Gate state machine, OWA helpers, audit integration

-- (A) Harmonise owa_ledger shape for patent features
ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS audit_hash text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'owa_ledger' AND column_name = 'credit_amount'
  ) THEN
    ALTER TABLE owa_ledger
      ADD COLUMN credit_amount numeric(18,2)
      GENERATED ALWAYS AS ((amount_cents::numeric) / 100.0) STORED;
  END IF;
END$$;

-- (B) Patent audit log fields layered onto canonical hash chain
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS message text;

-- (C) BAS Gate state machine ledger
CREATE TABLE IF NOT EXISTS bas_gate_states (
  id SERIAL PRIMARY KEY,
  period_id VARCHAR(32) NOT NULL,
  state VARCHAR(20) NOT NULL CHECK (state IN ('Open','Pending-Close','Reconciling','RPT-Issued','Remitted','Blocked')),
  reason_code VARCHAR(64),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hash_prev TEXT,
  hash_this TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_bas_gate_period ON bas_gate_states (period_id);

-- (D) Canonical balance helper view for the ledger
CREATE OR REPLACE VIEW owa_balance AS
SELECT tax_type AS kind,
       COALESCE(SUM(amount_cents),0)::numeric(18,2) / 100.0 AS balance
FROM owa_ledger
GROUP BY tax_type;

-- (E) Canonicalised RPT store view (backed by rpt_tokens)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname='rpt_store' AND relkind='r'
  ) THEN
    DROP TABLE rpt_store;
  END IF;
END$$;

CREATE OR REPLACE VIEW rpt_store AS
SELECT id,
       period_id,
       payload      AS rpt_json,
       signature    AS rpt_sig,
       created_at   AS issued_at
FROM rpt_tokens;
