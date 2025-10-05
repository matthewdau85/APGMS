-- 012_owa_unify.sql
-- Ensure the unified ledger table has columns required by the payments
-- service. The guards make the migration idempotent when applied multiple
-- times or against environments that already contain the columns.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'ledger'
  ) THEN
    CREATE TABLE public.ledger (
      id          BIGSERIAL PRIMARY KEY,
      abn         TEXT NOT NULL,
      tax_type    TEXT NOT NULL,
      source      TEXT NOT NULL,
      meta        JSONB DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ledger_abn_tax_idx ON public.ledger(abn, tax_type);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'direction'
  ) THEN
    ALTER TABLE public.ledger
      ADD COLUMN direction TEXT NOT NULL DEFAULT 'credit';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'amount_cents'
  ) THEN
    ALTER TABLE public.ledger
      ADD COLUMN amount_cents BIGINT NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'period_id'
  ) THEN
    ALTER TABLE public.ledger
      ADD COLUMN period_id BIGINT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'hash_head'
  ) THEN
    ALTER TABLE public.ledger
      ADD COLUMN hash_head TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'rpt_verified'
  ) THEN
    ALTER TABLE public.ledger
      ADD COLUMN rpt_verified BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ledger' AND column_name = 'bank_receipt_id'
  ) THEN
    ALTER TABLE public.ledger
      ADD COLUMN bank_receipt_id TEXT;
  END IF;
END $$;
