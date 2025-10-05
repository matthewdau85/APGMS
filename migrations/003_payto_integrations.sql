-- 003_payto_integrations.sql
-- PayTo mandate + debit persistence and bank remittance receipts

CREATE TABLE IF NOT EXISTS payto_mandates (
  id                SERIAL PRIMARY KEY,
  abn               TEXT NOT NULL,
  reference         TEXT NOT NULL,
  bank_mandate_id   TEXT NOT NULL,
  cap_cents         BIGINT NOT NULL,
  consumed_cents    BIGINT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL,
  meta              JSONB DEFAULT '{}'::jsonb,
  last_receipt_hash TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT payto_mandate_unique_ref UNIQUE (abn, reference),
  CONSTRAINT payto_mandate_unique_bank UNIQUE (bank_mandate_id)
);

CREATE TABLE IF NOT EXISTS payto_debits (
  id             BIGSERIAL PRIMARY KEY,
  mandate_id     TEXT NOT NULL REFERENCES payto_mandates(bank_mandate_id) ON DELETE CASCADE,
  abn            TEXT NOT NULL,
  amount_cents   BIGINT NOT NULL,
  status         TEXT NOT NULL,
  bank_reference TEXT,
  receipt_hash   TEXT,
  failure_reason TEXT,
  response       JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payto_debits_mandate_created_idx
  ON payto_debits (mandate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bank_remittances (
  id             BIGSERIAL PRIMARY KEY,
  period_id      TEXT NOT NULL UNIQUE,
  rpt_json       JSONB NOT NULL,
  bank_reference TEXT NOT NULL,
  bank_status    TEXT NOT NULL,
  receipt_hash   TEXT NOT NULL,
  bank_payload   JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

