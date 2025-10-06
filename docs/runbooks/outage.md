# Payments service outage

## Symptoms
- Health check `/health` returns non-200 or times out.
- `/ops/slo` endpoint unreachable or returns stale zeros.
- Grafana dashboard shows missing data for release metrics.
- Pager hook prints "PAGER would trigger" with multiple breach reasons.

## Checks
- Verify container/process status with `pm2 status` or systemd equivalent.
- Confirm Postgres is reachable from the payments host.
- Inspect recent deploy logs for crashes or migration errors.
- Check network connectivity and firewall rules to the metrics/ops ports.

## Commands
```bash
# Health check
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health

# Tail logs
journalctl -u payments-service -n 100 --no-pager

# Verify database connectivity
psql "$DATABASE_URL" -c 'SELECT now();'

# Confirm metrics endpoint responds once service is back
curl -s http://localhost:3000/metrics | head
```

## Rollback
- Revert to the last known good deployment artifact and redeploy.
- Restore database snapshot if recent migrations corrupted critical tables (coordinate with DBA).
- Disable new feature flags or configuration toggles introduced in the failing release.

## Contact tree
- **Primary:** Platform SRE on-call.
- **Secondary:** Payments service owner.
- **Escalation:** Incident commander / engineering director if outage exceeds 15 minutes.
