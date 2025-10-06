-- 003_security.sql
CREATE TABLE IF NOT EXISTS user_mfa (
  user_id TEXT PRIMARY KEY,
  secret_enc TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','active')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
