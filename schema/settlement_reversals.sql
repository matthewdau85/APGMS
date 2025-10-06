CREATE TABLE IF NOT EXISTS settlement_reversals (
  id BIGSERIAL PRIMARY KEY,
  txn_id TEXT NOT NULL,
  component TEXT NOT NULL CHECK (component IN ('GST','NET')),
  reversal_transfer_uuid UUID NOT NULL,
  amount_cents BIGINT NOT NULL,
  settlement_ts TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (txn_id, component, reversal_transfer_uuid)
);

CREATE INDEX IF NOT EXISTS settlement_reversals_txn_idx ON settlement_reversals (txn_id);
