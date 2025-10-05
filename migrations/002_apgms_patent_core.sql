-- 002_apgms_patent_core.sql
-- BAS Gate state machine, OWA ledger, audit hash chain, RPT store

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

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS message text;

ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS bank_receipt_hash text,
  ADD COLUMN IF NOT EXISTS prev_hash text,
  ADD COLUMN IF NOT EXISTS hash_after text;

CREATE TABLE IF NOT EXISTS rpt_store (
  id BIGSERIAL PRIMARY KEY,
  period_id VARCHAR(32) NOT NULL,
  rpt_json JSONB NOT NULL,
  rpt_sig  TEXT NOT NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Minimal guard view: no generic debit primitive
CREATE OR REPLACE VIEW owa_balance AS
SELECT tax_type AS kind,
       COALESCE(SUM(amount_cents),0)::numeric / 100.0 AS balance
FROM owa_ledger
GROUP BY tax_type;

-- Transition helper skeletons (fill with business rules in services)
