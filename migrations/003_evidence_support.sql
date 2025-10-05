-- 003_evidence_support.sql
-- Support tables for evidence bundles: BAS label mappings, reconciliation diffs, supporting documents

CREATE TABLE IF NOT EXISTS ledger_bas_mappings (
  id            BIGSERIAL PRIMARY KEY,
  ledger_id     BIGINT      NOT NULL REFERENCES owa_ledger(id) ON DELETE CASCADE,
  label         TEXT        NOT NULL CHECK (label IN ('W1','W2','1A','1B')),
  amount_cents  BIGINT,
  metadata      JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ledger_id, label)
);

CREATE TABLE IF NOT EXISTS reconciliation_diffs (
  id             BIGSERIAL PRIMARY KEY,
  abn            TEXT        NOT NULL,
  tax_type       TEXT        NOT NULL,
  period_id      TEXT        NOT NULL,
  diff_type      TEXT        NOT NULL,
  description    TEXT,
  expected_cents BIGINT,
  actual_cents   BIGINT,
  metadata       JSONB       NOT NULL DEFAULT '{}'::JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_diffs_period
  ON reconciliation_diffs (abn, tax_type, period_id, created_at);

CREATE TABLE IF NOT EXISTS supporting_documents (
  id         BIGSERIAL PRIMARY KEY,
  abn        TEXT        NOT NULL,
  tax_type   TEXT        NOT NULL,
  period_id  TEXT        NOT NULL,
  doc_type   TEXT        NOT NULL CHECK (doc_type IN ('BANK_RECEIPT','PROOF','ATO','INTERNAL')),
  reference  TEXT,
  uri        TEXT,
  hash       TEXT,
  metadata   JSONB       NOT NULL DEFAULT '{}'::JSONB,
  ledger_id  BIGINT      REFERENCES owa_ledger(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supporting_documents_period
  ON supporting_documents (abn, tax_type, period_id, created_at);
