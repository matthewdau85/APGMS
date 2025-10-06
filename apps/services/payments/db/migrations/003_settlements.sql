CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL,
  rail TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  paid_at TIMESTAMPTZ NOT NULL,
  simulated BOOLEAN NOT NULL DEFAULT true,
  meta JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS settlements_period_rail_idx
  ON settlements(period_id, rail, provider_ref);
