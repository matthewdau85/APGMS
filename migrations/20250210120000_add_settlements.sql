CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  rail TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ NULL,
  statement_ref TEXT NULL,
  evidence_id BIGINT NULL REFERENCES evidence_bundles(bundle_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_settlements_period ON settlements(period_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_settlements_provider ON settlements(provider_ref);
