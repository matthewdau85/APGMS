DO $$
BEGIN
  CREATE TYPE idempotency_status AS ENUM ('pending', 'applied', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

ALTER TABLE idempotency_keys RENAME COLUMN key TO id;
ALTER TABLE idempotency_keys RENAME COLUMN created_at TO first_seen;

ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS status idempotency_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS response_body BYTEA,
  ADD COLUMN IF NOT EXISTS http_status INT,
  ADD COLUMN IF NOT EXISTS response_content_type TEXT,
  ADD COLUMN IF NOT EXISTS ttl_secs INT NOT NULL DEFAULT 86400,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

UPDATE idempotency_keys
   SET status = CASE COALESCE(last_status, 'INIT')
                  WHEN 'DONE' THEN 'applied'
                  WHEN 'FAILED' THEN 'failed'
                  ELSE 'pending'
                END;

ALTER TABLE idempotency_keys DROP COLUMN IF EXISTS last_status;

UPDATE idempotency_keys
   SET updated_at = COALESCE(updated_at, first_seen),
       applied_at = CASE WHEN status = 'applied' AND applied_at IS NULL THEN first_seen ELSE applied_at END;

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_first_seen ON idempotency_keys (first_seen);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expiry ON idempotency_keys ((first_seen + make_interval(secs => COALESCE(ttl_secs, 0))));
