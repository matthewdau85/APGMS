-- 003_rpt_tokens_extensions.sql
-- Ensure RPT token store has the canonical fields required by the payments service

ALTER TABLE rpt_tokens
  ADD COLUMN IF NOT EXISTS key_id text,
  ADD COLUMN IF NOT EXISTS payload_c14n text,
  ADD COLUMN IF NOT EXISTS payload_sha256 text,
  ADD COLUMN IF NOT EXISTS nonce text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';

-- Keep signature column in sync (earlier scaffolds used sig_ed25519)
ALTER TABLE rpt_tokens
  ADD COLUMN IF NOT EXISTS signature text;

CREATE INDEX IF NOT EXISTS ix_rpt_tokens_lookup
  ON rpt_tokens (abn, tax_type, period_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_rpt_tokens_active
  ON rpt_tokens (abn, tax_type, period_id)
  WHERE status IN ('pending', 'active');

CREATE UNIQUE INDEX IF NOT EXISTS ux_rpt_tokens_nonce
  ON rpt_tokens (nonce)
  WHERE nonce IS NOT NULL;
