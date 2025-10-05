-- 013_ledger_hash.sql
-- Maintain a rolling hash for ledger continuity.
CREATE OR REPLACE FUNCTION ledger_hash_head_fn() RETURNS trigger AS $$
DECLARE
  prev TEXT;
BEGIN
  SELECT max(hash_head)
    INTO prev
    FROM ledger
   WHERE abn = NEW.abn
     AND COALESCE(period_id, -1) = COALESCE(NEW.period_id, -1);

  NEW.hash_head := encode(
    digest(
      COALESCE(prev, '') || json_build_object(
        'direction', NEW.direction,
        'amount_cents', NEW.amount_cents,
        'source', NEW.source,
        'meta', NEW.meta,
        'ts', now()
      )::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_hash ON ledger;
CREATE TRIGGER trg_ledger_hash
BEFORE INSERT ON ledger
FOR EACH ROW EXECUTE FUNCTION ledger_hash_head_fn();
