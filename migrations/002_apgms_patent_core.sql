-- 002_apgms_patent_core.sql
-- Following the consolidation into 001_apgms_core.sql the "patent"
-- migration simply reasserts helper views so that earlier deployments
-- observing this migration id remain idempotent. No conflicting table
-- definitions remain.

CREATE OR REPLACE VIEW owa_balance AS
SELECT
  tax_type,
  COALESCE(SUM(amount_cents), 0)::bigint AS balance
FROM owa_ledger
GROUP BY tax_type;
