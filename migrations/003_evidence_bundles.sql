-- 003_evidence_bundles.sql
-- Evidence bundle storage for auditor exports

CREATE TABLE IF NOT EXISTS evidence_bundles (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB NOT NULL,
  UNIQUE (abn, tax_type, period_id)
);

CREATE INDEX IF NOT EXISTS ix_evidence_bundles_created_at
  ON evidence_bundles (created_at DESC);
