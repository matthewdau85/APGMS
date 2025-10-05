-- 003_evidence_bundles.sql
-- Align evidence bundle storage with payments service expectations

CREATE TABLE IF NOT EXISTS evidence_bundles (
  bundle_id           BIGSERIAL PRIMARY KEY,
  abn                 TEXT NOT NULL,
  tax_type            TEXT NOT NULL,
  period_id           TEXT NOT NULL,
  payload_sha256      CHAR(64) NOT NULL,
  rpt_id              BIGINT REFERENCES rpt_tokens(id) ON DELETE SET NULL,
  rpt_payload         TEXT NOT NULL,
  rpt_signature       TEXT NOT NULL,
  thresholds_json     JSONB NOT NULL,
  anomaly_vector      JSONB NOT NULL,
  normalization_hashes JSONB NOT NULL,
  owa_balance_before  BIGINT NOT NULL,
  owa_balance_after   BIGINT NOT NULL,
  bank_receipts       JSONB NOT NULL,
  ato_receipts        JSONB NOT NULL,
  operator_overrides  JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (abn, tax_type, period_id)
);

CREATE INDEX IF NOT EXISTS ix_evidence_bundles_rpt_id
  ON evidence_bundles (rpt_id);
