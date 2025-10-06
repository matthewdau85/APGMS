# Release failures

## Symptoms
- `/ops/slo` shows `releaseErrorRate` above 5% or `p95ReleaseMs` breaching 5s.
- `/metrics` exposes `apgms_release_errors_total` increasing quickly.
- Operators or merchants report RPT verified but release API returns `Release failed` or validation errors.

## Checks
- Confirm the payments service is healthy: `curl -s http://localhost:3000/health`.
- Inspect recent ledger rows for the affected period to ensure balances are accurate.
- Query the DLQ depth gauge to ensure no periods are stuck in `BLOCKED_*` states.
- Review application logs for `payAtoRelease` rollback warnings or database constraint errors.

## Commands
```bash
# Live SLO snapshot
curl -s http://localhost:3000/ops/slo | jq

# Raw Prometheus metrics
curl -s http://localhost:3000/metrics

# Check the latest ledger entries for a specific period
psql "$DATABASE_URL" -c "SELECT id, amount_cents, balance_after_cents, created_at FROM owa_ledger WHERE abn='{{abn}}' AND tax_type='{{taxType}}' AND period_id='{{periodId}}' ORDER BY id DESC LIMIT 5;"

# Count blocked periods acting as the release DLQ
psql "$DATABASE_URL" -c "SELECT state, COUNT(*) FROM periods WHERE state LIKE 'BLOCKED%' GROUP BY state;"
```

## Rollback
- If a release attempt partially succeeded, replay the transfer by re-submitting the RPT after clearing DLQ conditions.
- For database errors (unique constraints, insufficient funds), reverse the ledger entry manually and re-run the API call once balances are corrected.
- Revert to the previous payments service build if a recent deployment introduced the regression.

## Contact tree
- **Primary:** Payments on-call engineer.
- **Secondary:** Reconciliation lead.
- **Escalation:** Platform SRE manager after 30 minutes without recovery.
