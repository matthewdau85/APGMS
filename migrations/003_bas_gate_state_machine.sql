-- 003_bas_gate_state_machine.sql
-- Strengthen BAS gate via enum, trigger-enforced transitions, and transition logging.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gate_state') THEN
    CREATE TYPE gate_state AS ENUM ('Open','Pending-Close','Reconciling','RPT-Issued','Remitted','Blocked');
  END IF;
END$$;

ALTER TABLE bas_gate_states
  ALTER COLUMN state TYPE gate_state USING state::gate_state,
  ADD COLUMN IF NOT EXISTS updated_by TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS transition_note TEXT,
  ADD COLUMN IF NOT EXISTS trace_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000';

CREATE TABLE IF NOT EXISTS bas_gate_transition_log (
  id BIGSERIAL PRIMARY KEY,
  period_id VARCHAR(32) NOT NULL,
  actor TEXT NOT NULL,
  reason_code VARCHAR(64),
  trace_id UUID NOT NULL,
  from_state gate_state,
  to_state gate_state NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bas_gate_transition_period_idx
  ON bas_gate_transition_log (period_id, created_at DESC);

CREATE OR REPLACE FUNCTION bas_gate_enforce_transition()
RETURNS TRIGGER AS $$
DECLARE
  allowed gate_state[] := ARRAY[]::gate_state[];
BEGIN
  IF NEW.updated_by IS NULL OR btrim(NEW.updated_by) = '' THEN
    RAISE EXCEPTION 'BAS gate transition requires updated_by';
  END IF;
  IF NEW.trace_id IS NULL THEN
    RAISE EXCEPTION 'BAS gate transition requires trace_id';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state IS NULL THEN
      RAISE EXCEPTION 'BAS gate state required';
    END IF;
    IF NEW.state <> 'Open' THEN
      RAISE EXCEPTION 'Initial BAS gate state must be Open';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.state
    WHEN 'Open' THEN ARRAY['Pending-Close','Blocked']::gate_state[]
    WHEN 'Pending-Close' THEN ARRAY['Reconciling','Blocked']::gate_state[]
    WHEN 'Reconciling' THEN ARRAY['RPT-Issued','Blocked']::gate_state[]
    WHEN 'RPT-Issued' THEN ARRAY['Remitted','Blocked']::gate_state[]
    WHEN 'Remitted' THEN ARRAY['Reconciling','Open']::gate_state[]
    WHEN 'Blocked' THEN ARRAY['Reconciling','Open']::gate_state[]
    ELSE ARRAY[]::gate_state[]
  END;

  IF array_length(allowed, 1) IS NULL OR NOT (NEW.state = ANY(allowed)) THEN
    RAISE EXCEPTION 'Illegal BAS gate transition % -> %', OLD.state, NEW.state;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bas_gate_log_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  INSERT INTO bas_gate_transition_log(period_id, actor, reason_code, trace_id, from_state, to_state, note)
  VALUES (NEW.period_id, NEW.updated_by, NEW.reason_code, NEW.trace_id,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD.state ELSE NULL END,
          NEW.state, NEW.transition_note);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bas_gate_enforce_transition_trg ON bas_gate_states;
CREATE TRIGGER bas_gate_enforce_transition_trg
BEFORE INSERT OR UPDATE ON bas_gate_states
FOR EACH ROW EXECUTE FUNCTION bas_gate_enforce_transition();

DROP TRIGGER IF EXISTS bas_gate_log_transition_trg ON bas_gate_states;
CREATE TRIGGER bas_gate_log_transition_trg
AFTER INSERT OR UPDATE ON bas_gate_states
FOR EACH ROW EXECUTE FUNCTION bas_gate_log_transition();

-- Ensure legacy rows carry non-placeholder trace/actor metadata
UPDATE bas_gate_states
SET updated_by = COALESCE(NULLIF(updated_by, ''), 'system'),
    trace_id = COALESCE(trace_id, '00000000-0000-0000-0000-000000000000');

ALTER TABLE bas_gate_states
  ALTER COLUMN updated_by DROP DEFAULT,
  ALTER COLUMN trace_id DROP DEFAULT;
