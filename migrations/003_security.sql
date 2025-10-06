-- 003_security.sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  totp_secret TEXT,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS release_approvals (
  id BIGSERIAL PRIMARY KEY,
  abn TEXT NOT NULL,
  tax_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  actor TEXT NOT NULL,
  request_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  UNIQUE (abn, tax_type, period_id, actor)
);

CREATE INDEX IF NOT EXISTS idx_release_approvals_period ON release_approvals(abn, tax_type, period_id);

ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS payload_c14n TEXT;
ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS payload_sha256 TEXT;

INSERT INTO users (email, password_hash, role, totp_secret, mfa_enabled)
VALUES ('finance.ops@example.com', '70c3348efe03bda6bf9d5b54ba99058b:88a9344b95a1b2406c4a399a80a0fbb60b1758976bb87c5b842831fef61456d74c5588dbb2b696699fe71fca9b4b56fe2a65e63ae76b5151d2694f988019f3ab', 'approver', 'WGWXLF2LMQBVSR24BVL5MTNZGGRROG2Y', TRUE)
ON CONFLICT (email) DO NOTHING;
