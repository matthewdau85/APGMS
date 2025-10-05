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

CREATE TABLE IF NOT EXISTS owa_ledger (
  id SERIAL PRIMARY KEY,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('PAYGW','GST')),
  credit_amount NUMERIC(18,2) NOT NULL,
  source_ref VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  audit_hash CHAR(64)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  event_time TIMESTAMP NOT NULL DEFAULT NOW(),
  category VARCHAR(32) NOT NULL, -- bas_gate, rpt, egress, security
  message TEXT NOT NULL,
  hash_prev CHAR(64),
  hash_this CHAR(64)
);

CREATE TABLE IF NOT EXISTS rpt_store (
  id BIGSERIAL PRIMARY KEY,
  period_id VARCHAR(32) NOT NULL,
  rpt_json JSONB NOT NULL,
  rpt_sig  TEXT NOT NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Minimal guard view: no generic debit primitive
CREATE VIEW owa_balance AS
SELECT kind, COALESCE(SUM(credit_amount),0) AS balance
FROM owa_ledger GROUP BY kind;

-- Transition helper skeletons (fill with business rules in services)
