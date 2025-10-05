-- 003_rpt_tokens_payload_upgrade.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rpt_tokens' AND column_name = 'payload_c14n'
  ) THEN
    ALTER TABLE rpt_tokens
      ADD COLUMN payload_c14n TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rpt_tokens' AND column_name = 'payload_sha256'
  ) THEN
    ALTER TABLE rpt_tokens
      ADD COLUMN payload_sha256 TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rpt_tokens' AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE rpt_tokens
      ADD COLUMN expires_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rpt_tokens' AND column_name = 'nonce'
  ) THEN
    ALTER TABLE rpt_tokens
      ADD COLUMN nonce TEXT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION jsonb_canonical_text(j JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result TEXT;
  first BOOLEAN := TRUE;
  r RECORD;
BEGIN
  IF j IS NULL THEN
    RETURN 'null';
  END IF;

  CASE jsonb_typeof(j)
    WHEN 'object' THEN
      result := '{';
      first := TRUE;
      FOR r IN SELECT key, value FROM jsonb_each(j) ORDER BY key LOOP
        IF NOT first THEN
          result := result || ',';
        ELSE
          first := FALSE;
        END IF;
        result := result || to_jsonb(r.key)::TEXT || ':' || jsonb_canonical_text(r.value);
      END LOOP;
      result := result || '}';
      RETURN result;

    WHEN 'array' THEN
      result := '[';
      first := TRUE;
      FOR r IN SELECT value, ordinality FROM jsonb_array_elements(j) WITH ORDINALITY ORDER BY ordinality LOOP
        IF NOT first THEN
          result := result || ',';
        ELSE
          first := FALSE;
        END IF;
        result := result || jsonb_canonical_text(r.value);
      END LOOP;
      result := result || ']';
      RETURN result;

    ELSE
      RETURN j::TEXT;
  END CASE;
END
$$;

WITH backfill AS (
  SELECT
    id,
    jsonb_canonical_text(payload::jsonb) AS c14n,
    NULLIF(COALESCE(payload->>'expiry_ts', payload->>'expires_at'), '') AS raw_expiry,
    COALESCE(payload->>'nonce', payload->>'jti') AS raw_nonce
  FROM rpt_tokens
)
UPDATE rpt_tokens t
SET
  payload_c14n = COALESCE(t.payload_c14n, b.c14n),
  payload_sha256 = COALESCE(
    t.payload_sha256,
    encode(digest(b.c14n, 'sha256'), 'hex')
  ),
  expires_at = COALESCE(
    t.expires_at,
    NULLIF(b.raw_expiry, '')::timestamptz
  ),
  nonce = COALESCE(t.nonce, b.raw_nonce)
FROM backfill b
WHERE t.id = b.id;

UPDATE rpt_tokens
SET status = 'active'
WHERE status IS NULL OR upper(status) = 'ISSUED';

CREATE UNIQUE INDEX IF NOT EXISTS ux_rpt_tokens_unique_pending_active
  ON rpt_tokens (abn, tax_type, period_id)
  WHERE status IN ('pending', 'active');

CREATE UNIQUE INDEX IF NOT EXISTS ux_rpt_tokens_nonce
  ON rpt_tokens (nonce)
  WHERE nonce IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_rpt_tokens_lookup
  ON rpt_tokens (abn, tax_type, period_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_rpt_tokens_expires_at
  ON rpt_tokens (expires_at);
