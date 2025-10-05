#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
DEFAULT_DB="${PGDATABASE:-apgms_smoke}"

run_psql() {
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$@"
}

echo "[migration-smoke] Scenario 1: fresh database"
PGDATABASE="$DEFAULT_DB" make -C "$ROOT_DIR" db-fresh SEED=seeds/seed_small.sql >/tmp/migration-smoke-fresh.log
cat /tmp/migration-smoke-fresh.log

run_psql -d "$DEFAULT_DB" -v ON_ERROR_STOP=1 -c "SELECT count(*) AS periods FROM periods;"
run_psql -d "$DEFAULT_DB" -v ON_ERROR_STOP=1 -c "SELECT period_id, credited_cents FROM v_period_balances ORDER BY period_id;"

LEGACY_DB="${DEFAULT_DB}_legacy"

echo "[migration-smoke] Scenario 2: upgrade from mid-version"
run_psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$LEGACY_DB\";"
run_psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$LEGACY_DB\";"

run_psql -d "$LEGACY_DB" -v ON_ERROR_STOP=1 -f "$ROOT_DIR/migrations/001_init.sql"

run_psql -d "$LEGACY_DB" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO periods (abn, tax_type, period_id, state, accrued_cents)
VALUES ('53004085616','GST','2024-12','OPEN', 1850000)
ON CONFLICT (abn, tax_type, period_id) DO NOTHING;
SELECT * FROM owa_append('53004085616','GST','2024-12', 900000, 'legacy-202412-1');
SELECT * FROM owa_append('53004085616','GST','2024-12', 950000, 'legacy-202412-2');
SQL

run_psql -d "$LEGACY_DB" -v ON_ERROR_STOP=1 -f "$ROOT_DIR/migrations/002_add_state.sql"

run_psql -d "$LEGACY_DB" -v ON_ERROR_STOP=1 <<'SQL'
SELECT periods_sync_totals('53004085616','GST','2024-12');
INSERT INTO bas_gate_states(period_id,state,reason_code,hash_prev,hash_this)
VALUES ('2024-12','Pending-Close','smoke', '', encode(digest('2024-12:Pending-Close','sha256'),'hex'))
ON CONFLICT (period_id) DO NOTHING;
SELECT state FROM periods WHERE period_id='2024-12';
SELECT state FROM bas_gate_states WHERE period_id='2024-12';
SQL

run_psql -d "$LEGACY_DB" -v ON_ERROR_STOP=1 -c "SELECT period_id, credited_cents FROM v_period_balances WHERE period_id='2024-12';"
run_psql -d "$LEGACY_DB" -v ON_ERROR_STOP=1 -c "SELECT count(*) AS audit_rows FROM audit_log;"

SPIKE_DB="${DEFAULT_DB}_spike"
echo "[migration-smoke] Scenario 3: spike seed validation"
run_psql -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$SPIKE_DB\";"
run_psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SPIKE_DB\";"
PGDATABASE="$SPIKE_DB" make -C "$ROOT_DIR" db-migrate >/tmp/migration-smoke-spike-migrate.log
cat /tmp/migration-smoke-spike-migrate.log
PGDATABASE="$SPIKE_DB" make -C "$ROOT_DIR" db-seed SEED=seeds/seed_spike.sql >/tmp/migration-smoke-spike-seed.log
cat /tmp/migration-smoke-spike-seed.log
run_psql -d "$SPIKE_DB" -v ON_ERROR_STOP=1 -c "SELECT period_id, state FROM bas_gate_states ORDER BY period_id;"

echo "[migration-smoke] Completed"
