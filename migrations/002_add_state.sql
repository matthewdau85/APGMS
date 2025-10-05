-- 002_add_state.sql
-- Harden BAS period state handling and add gate tracking

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'periods_state_check'
  ) THEN
    ALTER TABLE periods
      ADD CONSTRAINT periods_state_check
      CHECK (state IN ('OPEN','CLOSING','READY_RPT','RELEASED','BLOCKED_ANOMALY','BLOCKED_DISCREPANCY'));
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS bas_gate_states (
  id SERIAL PRIMARY KEY,
  period_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('Open','Pending-Close','Reconciling','RPT-Issued','Remitted','Blocked')),
  reason_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hash_prev TEXT,
  hash_this TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_bas_gate_period
  ON bas_gate_states (period_id);

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
      final_liability_cents = COALESCE(_cred, 0),
      state = CASE
        WHEN state IN ('OPEN','CLOSING') THEN 'CLOSING'
        ELSE state
      END
  WHERE abn = p_abn AND tax_type = p_tax AND period_id = p_period;
END;
$$ LANGUAGE plpgsql;
