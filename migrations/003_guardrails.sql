-- 003_guardrails.sql
-- Guardrails bundle: enhanced idempotency, rules manifest, recon imports, evidence approvals

BEGIN;

ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS path text,
  ADD COLUMN IF NOT EXISTS request_hash text,
  ADD COLUMN IF NOT EXISTS status_code integer,
  ADD COLUMN IF NOT EXISTS response_body jsonb,
  ADD COLUMN IF NOT EXISTS response_headers jsonb,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE rpt_tokens
  ADD COLUMN IF NOT EXISTS payload_c14n text,
  ADD COLUMN IF NOT EXISTS payload_sha256 text;

CREATE TABLE IF NOT EXISTS rules_manifests (
  id bigserial PRIMARY KEY,
  tax_type text NOT NULL,
  rates_version text NOT NULL,
  manifest_sha256 text NOT NULL,
  effective_from date,
  published_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (tax_type, rates_version)
);

CREATE TABLE IF NOT EXISTS reconciliation_imports (
  id bigserial PRIMARY KEY,
  abn text,
  tax_type text,
  period_id text,
  provider_ref text,
  imported_rows integer NOT NULL,
  manifest_sha256 text,
  raw_csv text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_approvals (
  id bigserial PRIMARY KEY,
  abn text NOT NULL,
  tax_type text NOT NULL,
  period_id text NOT NULL,
  approver text NOT NULL,
  role text,
  comment text,
  approved_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_narratives (
  id bigserial PRIMARY KEY,
  abn text NOT NULL,
  tax_type text NOT NULL,
  period_id text NOT NULL,
  author text,
  narrative text NOT NULL,
  created_at timestamptz DEFAULT now()
);

COMMIT;
