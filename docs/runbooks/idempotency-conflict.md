# Runbook: Idempotency Conflict Resolution

## When to Use
* Alert **Release failure (payments idempotency)** triggered (stage label `database`).
* `apgms_release_failures_total{service="payments",stage="database"}` increased and API returned HTTP 400 with `Release failed`.

## Immediate Actions
1. Inspect the payment ledger for duplicate `release_uuid` values:
   ```sql
   SELECT release_uuid, COUNT(*)
   FROM owa_ledger
   WHERE abn = $1 AND tax_type = $2 AND period_id = $3
   GROUP BY release_uuid
   HAVING COUNT(*) > 1;
   ```
2. Confirm the latest RPT verification succeeded by checking the request logs and `payments` Grafana panels.

## Conflict Resolution
1. Determine which entry represents the legitimate release by comparing timestamps and upstream receipts.
2. Reverse any duplicate or stale ledger rows with a compensating credit:
   ```sql
   INSERT INTO owa_ledger (...)
   SELECT ... -- use negative amount to negate the duplicate
   ```
3. Retry the `/payAto` API call once the ledger state is corrected.
4. Monitor `increase(apgms_release_failures_total{service="payments"}[5m])` to ensure no additional conflicts occur.

## Escalation
* If conflicts recur across multiple periods, disable automated releases and involve the payments domain expert.
