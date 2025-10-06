# APGMS Patent Core Validation Plan

The following `psql` session exercises the RPT issuance, payment release, idempotency replay, and evidence export
paths against the schema shipped in `migrations/002_apgms_patent_core.sql` together with the legacy period tables.

> **Prerequisites**
>
> * Apply migrations `001_apgms_core.sql`, `002_apgms_patent_core.sql`, and `002_patent_extensions.sql`.
> * Set `RPT_ED25519_SECRET_BASE64` and `ATO_PRN` environment variables for the API process.
> * Start the API so the middleware and adapters can be invoked during manual verification.

## 1. Seed a period and ledger credit

```sql
-- Open a period and credit the OWA ledger with 100.00 (10000 cents)
INSERT INTO periods(abn,tax_type,period_id,state,final_liability_cents,credited_to_owa_cents)
VALUES ('12345678901','GST','2025-09','CLOSING',10000,10000)
ON CONFLICT (abn,tax_type,period_id) DO UPDATE
SET state='CLOSING', final_liability_cents=10000, credited_to_owa_cents=10000;

SELECT owa_append('12345678901','GST','2025-09', 10000, 'seed:credit');
```

## 2. Issue an RPT token

```bash
curl -X POST http://localhost:3000/api/close-issue \
  -H 'Content-Type: application/json' \
  -d '{
        "abn":"12345678901",
        "taxType":"GST",
        "periodId":"2025-09",
        "thresholds":{"epsilon_cents":50}
      }'
```

Expected: HTTP 200 with payload + signature. Verify storage:

```sql
SELECT abn, tax_type, period_id, payload_sha256, signature
FROM rpt_tokens
WHERE abn='12345678901' AND tax_type='GST' AND period_id='2025-09'
ORDER BY id DESC LIMIT 1;
```

## 3. Release the payment (idempotent)

```bash
curl -X POST http://localhost:3000/api/pay \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-release-001' \
  -d '{
        "abn":"12345678901",
        "taxType":"GST",
        "periodId":"2025-09",
        "rail":"EFT"
      }'
```

Expected JSON fields: `transfer_uuid`, `bank_receipt_hash`, `balance_after_cents`, `audit_hash`, `status:"DONE"`.

Replay with the same idempotency key:

```bash
curl -X POST http://localhost:3000/api/pay \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-release-001' \
  -d '{
        "abn":"12345678901",
        "taxType":"GST",
        "periodId":"2025-09",
        "rail":"EFT"
      }'
```

Expected: HTTP 200 `{ "idempotent": true, "status": "DONE", "response_hash": "..." }` from middleware.

Database verification:

```sql
SELECT balance_after_cents, bank_receipt_hash, hash_after
FROM owa_ledger
WHERE abn='12345678901' AND tax_type='GST' AND period_id='2025-09'
ORDER BY id DESC LIMIT 1;

SELECT last_status, response_hash
FROM idempotency_keys
WHERE key='demo-release-001';

SELECT category, message, hash_prev, hash_this
FROM audit_log
ORDER BY id DESC LIMIT 1;
```

## 4. Export evidence bundle

```bash
curl "http://localhost:3000/api/evidence?abn=12345678901&taxType=GST&periodId=2025-09"
```

Expected JSON contains:

* `rpt.payload`, `rpt.signature`, `rpt.payload_sha256`.
* `owa_ledger_deltas` entries including the release debit with the hash chain intact.
* `bank_receipt_hash` echoing the synthetic bank receipt.

This plan can be recorded alongside application logs to demonstrate the reconciler, release adapter, idempotency
middleware, and evidence exporter all operate against the patent schema using fully parameterised SQL.
