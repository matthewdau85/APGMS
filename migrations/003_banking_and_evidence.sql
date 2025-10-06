-- 003_banking_and_evidence.sql

-- Simulation settlements captured when exercising the SimRail adapter.
CREATE TABLE IF NOT EXISTS sim_settlements (
  provider_ref        TEXT        PRIMARY KEY,
  idem_key            TEXT        UNIQUE NOT NULL,
  amount_cents        BIGINT      NOT NULL,
  paid_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  abn                 TEXT,
  tax_type            TEXT,
  period_id           TEXT,
  destination         JSONB       DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sim_settlements_paid_at_idx
  ON sim_settlements (paid_at);

CREATE INDEX IF NOT EXISTS sim_settlements_period_lookup_idx
  ON sim_settlements (abn, tax_type, period_id);

-- Ledger enrichments so releases can surface provider settlement information.
ALTER TABLE owa_ledger
  ADD COLUMN IF NOT EXISTS provider_ref           TEXT,
  ADD COLUMN IF NOT EXISTS provider_paid_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS owa_ledger_provider_ref_idx
  ON owa_ledger (provider_ref)
  WHERE provider_ref IS NOT NULL;

-- Narrative + approvals metadata to support Evidence v2 payloads.
ALTER TABLE periods
  ADD COLUMN IF NOT EXISTS narrative TEXT;

CREATE TABLE IF NOT EXISTS period_approvals (
  id         BIGSERIAL PRIMARY KEY,
  abn        TEXT        NOT NULL,
  tax_type   TEXT        NOT NULL,
  period_id  TEXT        NOT NULL,
  actor      TEXT        NOT NULL,
  note       TEXT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (abn, tax_type, period_id, actor)
);

