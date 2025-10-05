-- 002_apgms_patent_core.sql
-- BAS Gate state machine, OWA ledger, audit hash chain, RPT store

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gate_state') THEN
    CREATE TYPE gate_state AS ENUM ('OPEN','RECONCILING','RPT_ISSUED','RELEASED','BLOCKED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS bas_gate_states (
  id SERIAL PRIMARY KEY,
  period_id VARCHAR(32) NOT NULL,
  state gate_state NOT NULL,
  reason_code VARCHAR(64),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  hash_prev CHAR(64),
  hash_this CHAR(64)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_bas_gate_period ON bas_gate_states (period_id);

CREATE TABLE IF NOT EXISTS bas_gate_transition_log (
  id BIGSERIAL PRIMARY KEY,
  period_id VARCHAR(32) NOT NULL,
  actor TEXT,
  reason TEXT,
  trace_id TEXT,
  from_state gate_state,
  to_state gate_state NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_bas_gate_transition_period ON bas_gate_transition_log (period_id, created_at DESC);

DO $$
DECLARE
  has_varchar_column BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bas_gate_states' AND column_name = 'state' AND udt_name <> 'gate_state'
  ) INTO has_varchar_column;

  IF has_varchar_column THEN
    ALTER TABLE bas_gate_states DROP CONSTRAINT IF EXISTS bas_gate_states_state_check;
    UPDATE bas_gate_states SET state = 'OPEN' WHERE state = 'Open';
    UPDATE bas_gate_states SET state = 'RECONCILING' WHERE state IN ('Pending-Close','Reconciling');
    UPDATE bas_gate_states SET state = 'RPT_ISSUED' WHERE state = 'RPT-Issued';
    UPDATE bas_gate_states SET state = 'RELEASED' WHERE state = 'Remitted';
    UPDATE bas_gate_states SET state = 'BLOCKED' WHERE state = 'Blocked';
    ALTER TABLE bas_gate_states ALTER COLUMN state TYPE gate_state USING state::gate_state;
  END IF;
END$$;

CREATE OR REPLACE FUNCTION bas_gate_validate_transition()
RETURNS TRIGGER AS $$
DECLARE
  prior_state gate_state;
  actor TEXT;
  why TEXT;
  trace TEXT;
  allowed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    prior_state := NULL;
  ELSE
    prior_state := OLD.state;
  END IF;

  actor := NULLIF(current_setting('apgms.actor', TRUE), '');
  why := COALESCE(NULLIF(current_setting('apgms.reason', TRUE), ''), NEW.reason_code);
  trace := NULLIF(current_setting('apgms.trace_id', TRUE), '');

  IF prior_state IS NULL THEN
    allowed := NEW.state IN ('OPEN','BLOCKED');
  ELSE
    CASE prior_state
      WHEN 'OPEN' THEN
        allowed := NEW.state IN ('OPEN','RECONCILING','BLOCKED');
      WHEN 'RECONCILING' THEN
        allowed := NEW.state IN ('RECONCILING','RPT_ISSUED','BLOCKED');
      WHEN 'RPT_ISSUED' THEN
        allowed := NEW.state IN ('RPT_ISSUED','RELEASED','BLOCKED');
      WHEN 'RELEASED' THEN
        allowed := NEW.state = 'RELEASED';
      WHEN 'BLOCKED' THEN
        allowed := NEW.state IN ('BLOCKED','RECONCILING');
    END CASE;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid BAS gate transition from % to %', prior_state, NEW.state
      USING ERRCODE = 'P0001',
            HINT = 'Valid transitions: OPEN→RECONCILING→RPT_ISSUED→RELEASED. Use BLOCKED for holds; resolve blocks via RECONCILING.';
  END IF;

  INSERT INTO bas_gate_transition_log(period_id, actor, reason, trace_id, from_state, to_state)
  VALUES (NEW.period_id, actor, why, trace, prior_state, NEW.state);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bas_gate_state_guard ON bas_gate_states;
CREATE TRIGGER bas_gate_state_guard
BEFORE INSERT OR UPDATE ON bas_gate_states
FOR EACH ROW
EXECUTE FUNCTION bas_gate_validate_transition();

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
