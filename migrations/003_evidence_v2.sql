-- 003_evidence_v2.sql
-- Add narrative, settlement linkage, approvals, and rule manifest tracking for evidence bundles

-- ensure settlements table exists to link to
CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY,
  abn text NOT NULL,
  tax_type text NOT NULL,
  period_id text NOT NULL,
  provider_ref text NOT NULL,
  rail text NOT NULL,
  amount_cents bigint,
  currency text DEFAULT 'AUD',
  paid_at timestamptz,
  receipt_filename text,
  receipt_mime text,
  receipt_base64 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_ref)
);

-- approvals captured when releasing funds
CREATE TABLE IF NOT EXISTS release_approvals (
  id bigserial PRIMARY KEY,
  abn text NOT NULL,
  tax_type text NOT NULL,
  period_id text NOT NULL,
  approver_id text NOT NULL,
  approver_role text NOT NULL,
  mfa_verified boolean NOT NULL DEFAULT false,
  approved_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS release_approvals_period_idx
  ON release_approvals (abn, tax_type, period_id, approved_at);

-- extend evidence bundles with v2 columns
ALTER TABLE evidence_bundles
  ADD COLUMN IF NOT EXISTS rules_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approvals jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS narrative text,
  ADD COLUMN IF NOT EXISTS settlement_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'evidence_bundles_settlement_fk'
  ) THEN
    ALTER TABLE evidence_bundles
      ADD CONSTRAINT evidence_bundles_settlement_fk
      FOREIGN KEY (settlement_id) REFERENCES settlements(id);
  END IF;
END$$;
