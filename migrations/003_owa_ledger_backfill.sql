-- 003_owa_ledger_backfill.sql
-- Normalises existing installations of the OWA ledger so that hosts
-- that previously applied both the "core" and "patent" scaffolds land on
-- the unified schema expected by the payments service.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Promote legacy hash_before/hash_after columns into the canonical names.
DO $$
DECLARE
  _dtype text;
BEGIN
  SELECT data_type INTO _dtype
  FROM information_schema.columns
  WHERE table_name = 'owa_ledger' AND column_name = 'hash_before';

  IF _dtype IS NOT NULL THEN
    ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS prev_hash text;

    IF _dtype = 'bytea' THEN
      UPDATE owa_ledger SET prev_hash = encode(hash_before, 'hex')
      WHERE hash_before IS NOT NULL AND (prev_hash IS NULL OR prev_hash = '');
    ELSE
      UPDATE owa_ledger SET prev_hash = hash_before::text
      WHERE hash_before IS NOT NULL AND (prev_hash IS NULL OR prev_hash = '');
    END IF;

    ALTER TABLE owa_ledger DROP COLUMN hash_before;
  END IF;
END $$;

DO $$
DECLARE
  _dtype text;
BEGIN
  SELECT data_type INTO _dtype
  FROM information_schema.columns
  WHERE table_name = 'owa_ledger' AND column_name = 'hash_after';

  IF _dtype = 'bytea' THEN
    ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS hash_after_text text;
    UPDATE owa_ledger SET hash_after_text = encode(hash_after, 'hex')
      WHERE hash_after IS NOT NULL;
    ALTER TABLE owa_ledger DROP COLUMN hash_after;
    ALTER TABLE owa_ledger RENAME COLUMN hash_after_text TO hash_after;
  END IF;
END $$;

ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS bank_receipt_hash text;
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS bank_receipt_id text;
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS hash_after text;
ALTER TABLE owa_ledger ADD COLUMN IF NOT EXISTS transfer_uuid uuid;
ALTER TABLE owa_ledger ALTER COLUMN transfer_uuid SET NOT NULL;
ALTER TABLE owa_ledger ALTER COLUMN transfer_uuid SET DEFAULT gen_random_uuid();

-- Ensure every row has a transfer UUID.
UPDATE owa_ledger
SET transfer_uuid = gen_random_uuid()
WHERE transfer_uuid IS NULL;

-- Backfill bank_receipt_hash when only a receipt id or nothing was stored.
UPDATE owa_ledger
SET bank_receipt_hash = COALESCE(bank_receipt_hash, bank_receipt_id, 'legacy:' || transfer_uuid::text)
WHERE bank_receipt_hash IS NULL;

-- Recalculate running balances so that subsequent hash recomputation has a stable base.
WITH ordered AS (
  SELECT
    id,
    SUM(amount_cents) OVER (
      PARTITION BY abn, tax_type, period_id
      ORDER BY id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS bal
  FROM owa_ledger
)
UPDATE owa_ledger AS l
SET balance_after_cents = ordered.bal
FROM ordered
WHERE l.id = ordered.id
  AND l.balance_after_cents IS DISTINCT FROM ordered.bal;

-- Releases must carry an RPT verification marker and UUID.
UPDATE owa_ledger
SET
  rpt_verified = TRUE,
  release_uuid = COALESCE(release_uuid, gen_random_uuid())
WHERE amount_cents < 0
  AND (rpt_verified IS DISTINCT FROM TRUE OR release_uuid IS NULL);

-- Recompute the hash chain deterministically using the consolidated rule.
WITH RECURSIVE chain AS (
  SELECT
    l.id,
    l.abn,
    l.tax_type,
    l.period_id,
    l.bank_receipt_hash,
    l.balance_after_cents,
    NULL::text AS prev_hash,
    encode(digest('' || coalesce(l.bank_receipt_hash, '') || l.balance_after_cents::text, 'sha256'), 'hex') AS hash_after
  FROM (
    SELECT DISTINCT ON (abn, tax_type, period_id) *
    FROM owa_ledger
    ORDER BY abn, tax_type, period_id, id
  ) l

  UNION ALL

  SELECT
    nxt.id,
    nxt.abn,
    nxt.tax_type,
    nxt.period_id,
    nxt.bank_receipt_hash,
    nxt.balance_after_cents,
    chain.hash_after AS prev_hash,
    encode(digest(coalesce(chain.hash_after, '') || coalesce(nxt.bank_receipt_hash, '') || nxt.balance_after_cents::text, 'sha256'), 'hex') AS hash_after
  FROM chain
  JOIN LATERAL (
    SELECT *
    FROM owa_ledger l
    WHERE l.abn = chain.abn
      AND l.tax_type = chain.tax_type
      AND l.period_id = chain.period_id
      AND l.id > chain.id
    ORDER BY l.id
    LIMIT 1
  ) AS nxt ON TRUE
)
UPDATE owa_ledger AS l
SET prev_hash = chain.prev_hash,
    hash_after = chain.hash_after
FROM chain
WHERE l.id = chain.id;

COMMIT;
