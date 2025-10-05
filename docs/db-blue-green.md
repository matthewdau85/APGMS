# Prototype Blue/Green Database Cutover

This prototype environment uses a lightweight blue/green pattern so that application pods can be
swapped to a freshly migrated database without interrupting traffic. The process assumes the new
schema is backward compatible for the length of the cutover window.

## Overview

1. **Blue** is the actively serving PostgreSQL instance.
2. **Green** is a clone created from blue's latest snapshot. Migrations and smoke tests run against
   green while blue continues to serve read/write traffic.
3. Application services are flipped to green by swapping connection secrets once validation passes.
4. Blue remains on standby for rapid rollback until validation on green completes.

## Detailed Steps

1. **Snapshot the live cluster.**
   * Run a storage-level snapshot or `pg_dump --snapshot` against the blue instance.
   * Record WAL location to support point-in-time recovery if needed.
2. **Provision green.**
   * Restore the snapshot into a new PostgreSQL instance (`green-db`).
   * Update security groups and credentials but keep green isolated from production clients.
3. **Migrate green.**
   * Point `PGHOST`/`PGDATABASE` to the green instance.
   * Run `make db-migrate` followed by the `scripts/migration_smoke.sh` harness. The script applies
     migrations, runs the mid-version upgrade flow, and seeds validation traffic.
   * Review the logs and ensure the GitHub Action `migration-smoke` passes for the branch.
4. **Synchronize residual writes.**
   * Pause non-critical writers or switch application traffic to read-only mode.
   * Capture the WAL delta from blue after the snapshot. Replay it onto green using
     `pg_basebackup` or logical replication so green includes the latest committed rows.
5. **Cut application traffic.**
   * Update the secret/ConfigMap that holds the database connection URL to point at green.
   * Restart pods or trigger a rolling deploy so new connections target the green instance.
   * Monitor request errors, migrations logs, and the audit trail to confirm healthy traffic.
6. **Validation window.**
   * Keep blue online but idle. Run targeted checks: ledger balances, BAS gate states,
     and `periods_sync_totals` for the most recent periods.
   * If issues surface, revert the connection secret to blue and restart the pods.
7. **Promote and retire.**
   * Once green is stable, mark it as the new blue.
   * Decommission the old blue instance after taking a final snapshot for archive.

## Operational Tips

* Automate the cutover by wiring the GitHub Action `migration-smoke` into your deployment pipeline;
  require the job to pass before flipping traffic.
* Keep seed files (`seeds/seed_small.sql` and `seeds/seed_spike.sql`) updated with realistic BAS
  periods so smoke tests remain representative.
* For extended dual-run periods, direct read-only workloads (analytics, audit dashboards) to the
  standby instance to minimize performance impact during switchover.
