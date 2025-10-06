from __future__ import annotations

import os
from pathlib import Path

import pytest

try:
    import psycopg
    from psycopg import sql
except ModuleNotFoundError:  # pragma: no cover - dependency missing in developer env
    psycopg = None  # type: ignore[assignment]
    sql = None  # type: ignore[assignment]

MIGRATIONS_DIR = Path("migrations")


def _admin_dsn() -> str:
    return os.getenv("APGMS_TEST_ADMIN_DSN", "postgresql://postgres:postgres@localhost:5432/postgres")


def _database_name(stem: str) -> str:
    return f"apgms_ci_{stem}"


def _apply_sql(connection: "psycopg.Connection", sql_text: str) -> None:
    if not sql_text.strip():
        return
    connection.execute(sql_text)


@pytest.mark.parametrize("migration_path", sorted(MIGRATIONS_DIR.glob("*.sql")))
def test_each_migration_applies_cleanly(migration_path: Path) -> None:
    if psycopg is None:
        pytest.skip("psycopg not installed")

    admin_dsn = _admin_dsn()
    try:
        admin = psycopg.connect(admin_dsn, autocommit=True)
    except psycopg.OperationalError:
        pytest.skip("postgres not available for migration smoke test")

    db_name = _database_name(migration_path.stem)
    with admin:
        admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(db_name)))
        admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(db_name)))

    target_dsn = admin_dsn.rsplit("/", 1)[0] + f"/{db_name}"
    with psycopg.connect(target_dsn, autocommit=True) as conn:
        sql_text = migration_path.read_text(encoding="utf-8-sig")
        _apply_sql(conn, sql_text)
        conn.execute("SELECT 1")
