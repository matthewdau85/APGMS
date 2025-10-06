# Reconciliation DLQ backlog

## Symptoms
- `/ops/slo` shows `dlqDepth` above 0 for more than 10 minutes.
- Grafana dashboard highlights a sustained increase in blocked periods.
- Reconciliation job output indicates rows skipped or moved to DLQ files.

## Checks
- Verify payments service connectivity to Postgres: `curl -s http://localhost:3000/health`.
- Inspect the `periods` table for `BLOCKED_*` states and note associated ABNs/period IDs.
- Review recent reconcile worker logs for parsing errors or foreign key violations.
- Confirm upstream CSVs or bank feeds are complete and match ledger expectations.

## Commands
```bash
# List blocked periods ordered by update time
psql "$DATABASE_URL" -c "SELECT abn, tax_type, period_id, state, updated_at FROM periods WHERE state LIKE 'BLOCKED%' ORDER BY updated_at DESC LIMIT 20;"

# Re-run the reconcile worker for a specific file
node reconcile_worker.js data/credits_retry.csv

# Compare DLQ gauge
curl -s http://localhost:3000/ops/slo | jq '.dlqDepth'
```

## Rollback
- Re-queue DLQ items by clearing the blocking state after manual verification: `UPDATE periods SET state='READY_RPT' WHERE id=...`.
- If the backlog is caused by a bad ingest file, remove the offending rows and replay a clean copy.
- Escalate to data engineering if bank files are missing or malformed for multiple cycles.

## Contact tree
- **Primary:** Reconciliation on-call engineer.
- **Secondary:** Data ingestion specialist.
- **Escalation:** Finance operations lead if backlog persists over one reporting cycle.
