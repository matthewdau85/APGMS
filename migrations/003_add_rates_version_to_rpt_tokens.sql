-- 003_add_rates_version_to_rpt_tokens.sql
-- Adds rates_version column and backfills existing tokens so downstream services
-- can rely on the metadata.
BEGIN;

ALTER TABLE rpt_tokens
  ADD COLUMN IF NOT EXISTS rates_version TEXT;

UPDATE rpt_tokens
SET rates_version = COALESCE(rates_version, '2024-10-ATO-v1');

ALTER TABLE rpt_tokens
  ALTER COLUMN rates_version SET NOT NULL;

COMMIT;
