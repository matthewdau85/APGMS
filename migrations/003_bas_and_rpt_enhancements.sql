-- 003_bas_and_rpt_enhancements.sql
-- Ensure RPT metadata matches verification middleware and add BAS label storage.

ALTER TABLE rpt_tokens
  ADD COLUMN IF NOT EXISTS key_id text,
  ADD COLUMN IF NOT EXISTS payload_c14n text,
  ADD COLUMN IF NOT EXISTS payload_sha256 text,
  ADD COLUMN IF NOT EXISTS nonce text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ALTER COLUMN status SET DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS bas_labels (
  id serial PRIMARY KEY,
  abn text NOT NULL,
  tax_type text NOT NULL,
  period_id text NOT NULL,
  label text NOT NULL,
  value_cents bigint NOT NULL DEFAULT 0,
  UNIQUE (abn, tax_type, period_id, label)
);
