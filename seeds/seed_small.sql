-- seeds/seed_small.sql
-- Minimal set of BAS periods with representative ledger and gate records

BEGIN;
TRUNCATE TABLE bas_gate_states, owa_ledger, rpt_tokens, rpt_store, audit_log,
  remittance_destinations, idempotency_keys, periods
  RESTART IDENTITY CASCADE;

INSERT INTO periods (abn, tax_type, period_id, state, accrued_cents)
VALUES
  ('53004085616', 'GST', '2024-03', 'OPEN', 1500000),
  ('53004085616', 'GST', '2024-06', 'OPEN', 1800000),
  ('53004085616', 'GST', '2024-09', 'OPEN', 2100000);

SELECT * FROM owa_append('53004085616','GST','2024-03', 750000, 'seed-small-202403-1');
SELECT * FROM owa_append('53004085616','GST','2024-03', 750000, 'seed-small-202403-2');
SELECT periods_sync_totals('53004085616','GST','2024-03');

SELECT * FROM owa_append('53004085616','GST','2024-06', 600000, 'seed-small-202406-1');
SELECT * FROM owa_append('53004085616','GST','2024-06', 1200000, 'seed-small-202406-2');
SELECT periods_sync_totals('53004085616','GST','2024-06');

SELECT * FROM owa_append('53004085616','GST','2024-09', 900000, 'seed-small-202409-1');
SELECT * FROM owa_append('53004085616','GST','2024-09', 1200000, 'seed-small-202409-2');
SELECT periods_sync_totals('53004085616','GST','2024-09');

WITH payload AS (
  SELECT json_build_object('event','seed','period_id','2024-03','state','Pending-Close')::TEXT AS msg
), chain AS (
  SELECT ''::TEXT AS prev_hash,
         encode(digest(payload.msg, 'sha256'), 'hex') AS this_hash
  FROM payload
)
INSERT INTO audit_log(category, message, hash_prev, hash_this, prev_hash, terminal_hash)
SELECT 'bas_gate', payload.msg, chain.prev_hash, chain.this_hash, chain.prev_hash, chain.this_hash
FROM payload, chain;

INSERT INTO bas_gate_states(period_id, state, reason_code, hash_prev, hash_this)
VALUES
  ('2024-03', 'Pending-Close', 'seed:small', '', encode(digest('2024-03:Pending-Close', 'sha256'), 'hex')),
  ('2024-06', 'Open', NULL, NULL, NULL),
  ('2024-09', 'Open', NULL, NULL, NULL)
ON CONFLICT (period_id) DO UPDATE
  SET state = EXCLUDED.state,
      reason_code = EXCLUDED.reason_code,
      hash_prev = EXCLUDED.hash_prev,
      hash_this = EXCLUDED.hash_this,
      updated_at = NOW();

COMMIT;
