# Runbook: DB Pool Exhaustion

## When to Use
* Alert **DB pool active connections > 80%** triggered for any service.
* Grafana *DB Pool Usage* panel shows `active` lines approaching `total`.

## Immediate Actions
1. Identify which service is breaching and gather recent deployment info.
2. Inspect the application logs for slow queries or unclosed transactions.

## Mitigation
1. Enable connection logging in PostgreSQL for the affected service and capture the `pg_stat_activity` output.
2. Recycle the service pods or processes to free orphaned connections.
3. If recurring, increase pool size temporarily while addressing application leaks.

## Escalation
* If pool exhaustion causes customer-facing errors, engage the database on-call engineer and evaluate read-only failover options.
