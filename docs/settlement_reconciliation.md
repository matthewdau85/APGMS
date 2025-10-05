# Settlement Reconciliation Flow

This document explains how split-payment settlement files from the acquiring bank are reconciled into APGMS ledgers. It covers the webhook contract, validation steps, ledger side-effects, and how operators can trace a settlement end-to-end.

## Inbound data contract

The `/api/settlement/webhook` endpoint accepts a CSV payload via `req.body.csv`. Each record must provide the following columns:

| Column | Description |
| --- | --- |
| `txn_id` | UUID of the originating payable (`owa_ledger.transfer_uuid`) released to the ATO |
| `gst_cents` | GST component (positive for settlement, negative for reversal) |
| `net_cents` | Net component (positive for settlement, negative for reversal) |
| `settlement_ts` | ISO-8601 timestamp supplied by the bank |

Rows are parsed and normalised to integers before processing; non-integer values are rejected so ledger math remains exact.【F:src/settlement/splitParser.ts†L3-L11】【F:src/routes/reconcile.ts†L45-L63】

## Processing pipeline

For every parsed row the webhook performs the following transactional workflow:

1. **Payable verification** – lock and validate the originating payable in `owa_ledger`. The entry must exist and represent an outbound release (negative `amount_cents`).【F:src/routes/reconcile.ts†L65-L82】
2. **Idempotency filter** – skip any component that already exists in `settlement_reversals` with the same (`txn_id`, `component`, `amount_cents`, `settlement_ts`). Entire rows without new work are counted as duplicates in the response.【F:src/routes/reconcile.ts†L84-L108】【F:src/routes/reconcile.ts†L132-L134】
3. **Balance guardrails** – ensure the cumulative settled amount for `txn_id` never exceeds the absolute payable, nor drops below zero when processing reversals.【F:src/routes/reconcile.ts†L110-L122】
4. **Ledger posting** – append GST and NET entries to `owa_ledger`, preserving running balance order and stamping the bank timestamp onto `created_at`.【F:src/routes/reconcile.ts†L124-L145】
5. **Reversal map persistence** – write the new split entry into `settlement_reversals`, linking the original `txn_id` to the reversal `transfer_uuid` for traceability.【F:src/routes/reconcile.ts†L147-L156】

The endpoint responds with counts of unique rows ingested and duplicate rows that were skipped.【F:src/routes/reconcile.ts†L136-L141】

## Ledger impacts

Every settlement inserts two entries (GST and NET) per row unless a component is zero or already recorded. Entries use fresh UUIDs but inherit the original `abn`, `tax_type`, and `period_id` from the payable so auditors can follow the balance trajectory. The helper table below records the mapping required to unwind or audit settlements later on.【F:schema/settlement_reversals.sql†L1-L11】

```sql
SELECT ol.transfer_uuid AS payable_txn,
       sr.component,
       sr.reversal_transfer_uuid,
       sr.amount_cents,
       sr.settlement_ts
  FROM settlement_reversals sr
  JOIN owa_ledger ol ON ol.transfer_uuid = sr.txn_id
 ORDER BY sr.settlement_ts;
```

This query yields the full lineage from release to settlement splits, supporting duplicate detection, reversals, and partial settlement tracking for operations teams.【F:apps/services/payments/test/settlement_webhook.test.ts†L108-L178】
