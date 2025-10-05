-- seeds/seed_spike.sql
-- Stress sample with higher volume ledger activity across three BAS periods

BEGIN;
TRUNCATE TABLE bas_gate_states, owa_ledger, rpt_tokens, rpt_store, audit_log,
  remittance_destinations, idempotency_keys, periods
  RESTART IDENTITY CASCADE;

INSERT INTO periods (abn, tax_type, period_id, state, accrued_cents, thresholds)
VALUES
  ('53004085616', 'GST', '2024-03', 'CLOSING', 2500000, jsonb_build_object('variance', 0.05)),
  ('53004085616', 'GST', '2024-06', 'READY_RPT', 2750000, jsonb_build_object('variance', 0.04)),
  ('53004085616', 'GST', '2024-09', 'OPEN', 3200000, jsonb_build_object('variance', 0.03));

-- March period traffic
SELECT * FROM owa_append('53004085616','GST','2024-03', 800000, 'spike-202403-1');
SELECT * FROM owa_append('53004085616','GST','2024-03', 820000, 'spike-202403-2');
SELECT * FROM owa_append('53004085616','GST','2024-03', -20000, NULL);
SELECT * FROM owa_append('53004085616','GST','2024-03', 900000, 'spike-202403-3');
SELECT periods_sync_totals('53004085616','GST','2024-03');

-- June period traffic
SELECT * FROM owa_append('53004085616','GST','2024-06', 950000, 'spike-202406-1');
SELECT * FROM owa_append('53004085616','GST','2024-06', 500000, 'spike-202406-2');
SELECT * FROM owa_append('53004085616','GST','2024-06', 700000, 'spike-202406-3');
SELECT * FROM owa_append('53004085616','GST','2024-06', 600000, 'spike-202406-4');
SELECT periods_sync_totals('53004085616','GST','2024-06');

-- September period traffic
SELECT * FROM owa_append('53004085616','GST','2024-09', 1000000, 'spike-202409-1');
SELECT * FROM owa_append('53004085616','GST','2024-09', 1100000, 'spike-202409-2');
SELECT * FROM owa_append('53004085616','GST','2024-09', 900000, 'spike-202409-3');
SELECT * FROM owa_append('53004085616','GST','2024-09', -150000, NULL);
SELECT * FROM owa_append('53004085616','GST','2024-09', 450000, 'spike-202409-4');
SELECT periods_sync_totals('53004085616','GST','2024-09');

-- Audit events chained in sequence
WITH first_event AS (
  SELECT json_build_object('event','seed','period_id','2024-03','state','Reconciling')::TEXT AS msg,
         ''::TEXT AS prev
), first_hash AS (
  SELECT msg, prev, encode(digest(prev || msg, 'sha256'), 'hex') AS this
  FROM first_event
)
INSERT INTO audit_log(category, message, hash_prev, hash_this, prev_hash, terminal_hash)
SELECT 'bas_gate', msg, prev, this, prev, this FROM first_hash;

WITH second_event AS (
  SELECT json_build_object('event','seed','period_id','2024-06','state','RPT-Issued')::TEXT AS msg,
         (SELECT hash_this FROM audit_log ORDER BY seq DESC LIMIT 1) AS prev
), second_hash AS (
  SELECT msg, prev, encode(digest(coalesce(prev,'') || msg, 'sha256'), 'hex') AS this
  FROM second_event
)
INSERT INTO audit_log(category, message, hash_prev, hash_this, prev_hash, terminal_hash)
SELECT 'bas_gate', msg, prev, this, prev, this FROM second_hash;

WITH third_event AS (
  SELECT json_build_object('event','seed','period_id','2024-09','state','Open')::TEXT AS msg,
         (SELECT hash_this FROM audit_log ORDER BY seq DESC LIMIT 1) AS prev
), third_hash AS (
  SELECT msg, prev, encode(digest(coalesce(prev,'') || msg, 'sha256'), 'hex') AS this
  FROM third_event
)
INSERT INTO audit_log(category, message, hash_prev, hash_this, prev_hash, terminal_hash)
SELECT 'bas_gate', msg, prev, this, prev, this FROM third_hash;

INSERT INTO bas_gate_states(period_id, state, reason_code, hash_prev, hash_this)
VALUES
  ('2024-03', 'Reconciling', 'seed:spike', '', encode(digest('2024-03:Reconciling', 'sha256'), 'hex')),
  ('2024-06', 'RPT-Issued', 'seed:spike', encode(digest('2024-03:Reconciling', 'sha256'), 'hex'),
    encode(digest('2024-06:RPT-Issued', 'sha256'), 'hex')),
  ('2024-09', 'Open', NULL, NULL, NULL)
ON CONFLICT (period_id) DO UPDATE
  SET state = EXCLUDED.state,
      reason_code = EXCLUDED.reason_code,
      hash_prev = EXCLUDED.hash_prev,
      hash_this = EXCLUDED.hash_this,
      updated_at = NOW();

INSERT INTO rpt_tokens(abn, tax_type, period_id, payload, signature, payload_c14n, payload_sha256, status)
VALUES
  ('53004085616','GST','2024-03', json_build_object('lines',10), 'sig-202403', '{"lines":10}',
    encode(digest('{"lines":10}', 'sha256'), 'hex'), 'ISSUED'),
  ('53004085616','GST','2024-06', json_build_object('lines',12), 'sig-202406', '{"lines":12}',
    encode(digest('{"lines":12}', 'sha256'), 'hex'), 'ISSUED');

INSERT INTO rpt_store(period_id, rpt_json, rpt_sig)
VALUES
  ('2024-06', json_build_object('period','2024-06','amount', 2750000), 'sig-202406'),
  ('2024-03', json_build_object('period','2024-03','amount', 2500000), 'sig-202403');

COMMIT;
