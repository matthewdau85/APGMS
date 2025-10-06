# apps/services/audit/main.py
from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, Generator, Optional

import psycopg2
from fastapi import FastAPI, HTTPException
from psycopg2 import pool
from psycopg2.extras import RealDictCursor

LOGGER = logging.getLogger(__name__)

app = FastAPI(title="audit")

DB_MIN_CONN = int(os.getenv("PGPOOL_MIN", "1"))
DB_MAX_CONN = int(os.getenv("PGPOOL_MAX", "5"))

_POOL: Optional[pool.SimpleConnectionPool] = None


def _get_connection_kwargs() -> Dict[str, Any]:
    return {
        "host": os.getenv("PGHOST", "127.0.0.1"),
        "user": os.getenv("PGUSER", "postgres"),
        "password": os.getenv("PGPASSWORD", "postgres"),
        "dbname": os.getenv("PGDATABASE", "postgres"),
        "port": int(os.getenv("PGPORT", "5432")),
    }


def init_pool(minconn: int = DB_MIN_CONN, maxconn: int = DB_MAX_CONN) -> None:
    """Initialise the global connection pool."""

    global _POOL
    if _POOL is None:
        LOGGER.info(
            "Initialising audit-service connection pool (min=%s, max=%s)",
            minconn,
            maxconn,
        )
        _POOL = pool.SimpleConnectionPool(minconn, maxconn, **_get_connection_kwargs())


def close_pool() -> None:
    """Close all pooled connections."""

    global _POOL
    if _POOL is not None:
        LOGGER.info("Closing audit-service connection pool")
        _POOL.closeall()
        _POOL = None


def get_pool() -> pool.SimpleConnectionPool:
    if _POOL is None:
        raise RuntimeError("Database pool has not been initialised")
    return _POOL


@contextmanager
def db_cursor() -> Generator[RealDictCursor, None, None]:
    connection_pool = get_pool()
    conn = connection_pool.getconn()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            yield cursor
        finally:
            cursor.close()
            conn.rollback()
    finally:
        connection_pool.putconn(conn)


@app.on_event("startup")
def _on_startup() -> None:
    if os.getenv("AUDIT_SKIP_POOL_INIT") == "1":
        LOGGER.info("Skipping connection pool initialisation per AUDIT_SKIP_POOL_INIT")
        return
    init_pool()


@app.on_event("shutdown")
def _on_shutdown() -> None:
    close_pool()


def _serialise_datetime(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


@app.get("/audit/bundle/{period_id}")
def bundle(period_id: str) -> Dict[str, Any]:
    try:
        with db_cursor() as cursor:
            cursor.execute(
                """
                SELECT rpt_json, rpt_sig, issued_at
                FROM rpt_store
                WHERE period_id=%s
                ORDER BY issued_at DESC
                LIMIT 1
                """,
                (period_id,),
            )
            rpt_row = cursor.fetchone()

            cursor.execute(
                """
                SELECT event_time, category, message
                FROM audit_log
                WHERE message LIKE %s
                ORDER BY event_time
                """,
                (f'%"period_id":"{period_id}"%',),
            )
            audit_rows = cursor.fetchall()

    except psycopg2.Error as exc:  # pragma: no cover - defensive catch
        LOGGER.exception(
            "Database error while fetching audit bundle for period %s", period_id
        )
        raise HTTPException(status_code=500, detail="Database error") from exc
    except RuntimeError as exc:
        LOGGER.exception("Database pool unavailable")
        raise HTTPException(status_code=500, detail="Service not ready") from exc

    report: Optional[Dict[str, Any]] = None
    if rpt_row:
        report = {
            "rpt_json": rpt_row.get("rpt_json"),
            "rpt_sig": rpt_row.get("rpt_sig"),
            "issued_at": _serialise_datetime(rpt_row.get("issued_at")),
        }

    logs = (
        [
            {
                "event_time": _serialise_datetime(row.get("event_time")),
                "category": row.get("category"),
                "message": row.get("message"),
            }
            for row in audit_rows
        ]
        if audit_rows
        else []
    )

    return {"period_id": period_id, "rpt": report, "audit": logs}


@app.get("/healthz")
def healthz() -> Dict[str, str]:
    try:
        with db_cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Service not ready") from exc
    except psycopg2.Error as exc:  # pragma: no cover - defensive catch
        LOGGER.exception("Database error during health check")
        raise HTTPException(status_code=503, detail="Database error") from exc

    return {"status": "ok"}
