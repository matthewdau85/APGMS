#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MIG_DIR="$ROOT_DIR/migrations"

if [[ ! -d "$MIG_DIR" ]]; then
  echo "migrations directory missing" >&2
  exit 1
fi

DATABASE_URL=${DATABASE_URL:-}
if [[ -z "$DATABASE_URL" ]]; then
  PGUSER=${PGUSER:-postgres}
  PGPASSWORD=${PGPASSWORD:-postgres}
  PGHOST=${PGHOST:-127.0.0.1}
  PGPORT=${PGPORT:-5432}
  PGDATABASE=${PGDATABASE:-postgres}
  export PGPASSWORD
  DATABASE_URL="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"
fi

for file in $(ls "$MIG_DIR"/*.sql | sort); do
  echo "Applying migration $(basename "$file")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
done
