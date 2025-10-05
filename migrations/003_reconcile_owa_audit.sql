-- 003_reconcile_owa_audit.sql
-- Normalize legacy patent schemas for owa_ledger and audit_log

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
DECLARE
  has_kind boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'owa_ledger' AND column_name = 'kind'
  ) INTO has_kind;

  IF has_kind THEN
    -- Ensure canonical columns exist
    ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS abn text;
    ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS tax_type text;
    ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS period_id text;
    ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS transfer_uuid uuid;
    ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS amount_cents bigint;
    ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS balance_after_cents bigint;
    ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS bank_receipt_hash text;
    ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS prev_hash text;
    ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS hash_after text;
    ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS created_at timestamptz;

    UPDATE owa_ledger
      SET tax_type = COALESCE(tax_type, kind);

    UPDATE owa_ledger
      SET amount_cents = COALESCE(amount_cents, (credit_amount * 100)::bigint);

    UPDATE owa_ledger
      SET bank_receipt_hash = COALESCE(bank_receipt_hash, source_ref);

    UPDATE owa_ledger
      SET hash_after = COALESCE(hash_after, audit_hash);

    UPDATE owa_ledger
      SET created_at = COALESCE(created_at, NOW());

    UPDATE owa_ledger
      SET abn = COALESCE(abn, '__legacy__');

    UPDATE owa_ledger
      SET period_id = COALESCE(period_id, '__legacy__');

    UPDATE owa_ledger
      SET transfer_uuid = COALESCE(transfer_uuid, gen_random_uuid());

    -- Running balances and chain repair
    WITH running AS (
      SELECT id,
             SUM(COALESCE(amount_cents, 0)) OVER (
               PARTITION BY COALESCE(abn, '__legacy__'), COALESCE(tax_type, 'UNKNOWN'), COALESCE(period_id, '__legacy__')
               ORDER BY id
             ) AS bal
      FROM owa_ledger
    )
    UPDATE owa_ledger o
      SET balance_after_cents = running.bal
    FROM running
    WHERE o.id = running.id;

    WITH chain AS (
      SELECT id,
             LAG(hash_after) OVER (
               PARTITION BY COALESCE(abn, '__legacy__'), COALESCE(tax_type, 'UNKNOWN'), COALESCE(period_id, '__legacy__')
               ORDER BY id
             ) AS prev
      FROM owa_ledger
    )
    UPDATE owa_ledger o
      SET prev_hash = COALESCE(o.prev_hash, chain.prev)
    FROM chain
    WHERE o.id = chain.id;

    ALTER TABLE owa_ledger
      ALTER COLUMN abn SET NOT NULL,
      ALTER COLUMN tax_type SET NOT NULL,
      ALTER COLUMN period_id SET NOT NULL,
      ALTER COLUMN transfer_uuid SET NOT NULL,
      ALTER COLUMN amount_cents SET NOT NULL,
      ALTER COLUMN balance_after_cents SET NOT NULL,
      ALTER COLUMN created_at SET NOT NULL;

    ALTER TABLE owa_ledger
      ALTER COLUMN transfer_uuid SET DEFAULT gen_random_uuid(),
      ALTER COLUMN created_at SET DEFAULT now();

    ALTER TABLE owa_ledger
      ALTER COLUMN created_at TYPE timestamptz USING created_at::timestamptz;

    ALTER TABLE owa_ledger
      DROP COLUMN IF EXISTS kind,
      DROP COLUMN IF EXISTS credit_amount,
      DROP COLUMN IF EXISTS source_ref,
      DROP COLUMN IF EXISTS audit_hash;
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'seq'
  ) THEN
    ALTER TABLE audit_log RENAME COLUMN id TO seq;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'event_time'
  ) THEN
    ALTER TABLE audit_log RENAME COLUMN event_time TO ts;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'hash_prev'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'prev_hash'
  ) THEN
    ALTER TABLE audit_log RENAME COLUMN hash_prev TO prev_hash;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'hash_this'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'terminal_hash'
  ) THEN
    ALTER TABLE audit_log RENAME COLUMN hash_this TO terminal_hash;
  END IF;

  ALTER TABLE audit_log
    ADD COLUMN IF NOT EXISTS actor text,
    ADD COLUMN IF NOT EXISTS action text,
    ADD COLUMN IF NOT EXISTS category text,
    ADD COLUMN IF NOT EXISTS message text,
    ADD COLUMN IF NOT EXISTS payload_hash text,
    ADD COLUMN IF NOT EXISTS prev_hash text,
    ADD COLUMN IF NOT EXISTS terminal_hash text;

  UPDATE audit_log
    SET actor = COALESCE(actor, 'system'),
        action = COALESCE(action, COALESCE(category, 'event')),
        category = COALESCE(category, action),
        message = COALESCE(message, ''),
        prev_hash = NULLIF(prev_hash, ''),
        payload_hash = COALESCE(payload_hash, encode(digest(message::text, 'sha256'), 'hex')),
        terminal_hash = COALESCE(terminal_hash, encode(digest(COALESCE(prev_hash, '') || encode(digest(message::text, 'sha256'), 'hex'), 'sha256'), 'hex'))
  WHERE payload_hash IS NULL OR terminal_hash IS NULL OR actor IS NULL;

  ALTER TABLE audit_log
    ALTER COLUMN ts TYPE timestamptz USING ts::timestamptz,
    ALTER COLUMN ts SET NOT NULL,
    ALTER COLUMN ts SET DEFAULT now();
END$$;
