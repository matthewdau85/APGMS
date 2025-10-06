-- 003_evidence_bundles.sql
CREATE TABLE IF NOT EXISTS evidence_bundles (
  period_id text NOT NULL,
  abn text NOT NULL,
  created_at timestamptz DEFAULT now(),
  details jsonb NOT NULL,
  PRIMARY KEY (abn, period_id)
);
