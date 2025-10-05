from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, Optional

import orjson
import psycopg
from fastapi import FastAPI, HTTPException, Response
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrNoServers
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from pydantic import BaseModel

app = FastAPI(title="recon")

SUBJECT_RECON = os.getenv("SUBJECT_RECON", "recon.v1.result")
NATS_URL = os.getenv("NATS_URL", "nats://nats:4222")

_nc: Optional[NATS] = None
_db_conn: Optional[psycopg.AsyncConnection] = None
_db_lock = asyncio.Lock()
_started = asyncio.Event()
_ready = asyncio.Event()

if not logging.getLogger().handlers:
    logging.basicConfig(level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO))

logger = logging.getLogger("recon")


def _pg_dsn() -> str:
    if url := os.getenv("DATABASE_URL"):
        return url
    host = os.getenv("PGHOST", "postgres")
    user = os.getenv("PGUSER", "apgms")
    password = os.getenv("PGPASSWORD", "apgms_pw")
    database = os.getenv("PGDATABASE", "apgms")
    port = os.getenv("PGPORT", "5432")
    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


PG_DSN = _pg_dsn()

RECON_MESSAGES = Counter("recon_messages_total", "Recon summaries processed", ["status"])
RECON_ERRORS = Counter("recon_messages_errors_total", "Recon summaries that failed")
NATS_CONNECTED = Gauge("recon_nats_connected", "1 if connected to NATS")
RECON_LAT = Histogram("recon_apply_seconds", "Latency to apply recon summary")


class ReconStatusRequest(BaseModel):
    abn: str
    tax_type: str
    period_id: str


async def _get_db_conn() -> psycopg.AsyncConnection:
    global _db_conn
    if _db_conn and not _db_conn.closed:
        return _db_conn
    _db_conn = await psycopg.AsyncConnection.connect(PG_DSN)
    return _db_conn


async def _run_db(fn):
    async with _db_lock:
        conn = await _get_db_conn()
        try:
            result = await fn(conn)
            await conn.commit()
            return result
        except Exception:
            await conn.rollback()
            raise


async def _upsert_recon_input(conn: psycopg.AsyncConnection, summary: Dict[str, Any]) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO recon_inputs (abn, tax_type, period_id, expected_cents, tolerance_cents, actual_cents, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,NOW())
            ON CONFLICT (abn, tax_type, period_id)
            DO UPDATE SET
                expected_cents = EXCLUDED.expected_cents,
                tolerance_cents = EXCLUDED.tolerance_cents,
                actual_cents = EXCLUDED.actual_cents,
                updated_at = NOW()
            """,
            (
                summary["abn"],
                summary["taxType"],
                summary["period_id"],
                summary["expectedCents"],
                summary["toleranceCents"],
                summary["actualCents"],
            ),
        )


async def _insert_result(conn: psycopg.AsyncConnection, summary: Dict[str, Any], status: str) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO recon_results (
                abn, tax_type, period_id,
                expected_cents, actual_cents, delta_cents,
                tolerance_cents, tolerance_bps, status
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                summary["abn"],
                summary["taxType"],
                summary["period_id"],
                summary["expectedCents"],
                summary["actualCents"],
                summary["deltaCents"],
                summary["toleranceCents"],
                summary["toleranceBps"],
                status,
            ),
        )


async def _sync_period(conn: psycopg.AsyncConnection, summary: Dict[str, Any], status: str) -> None:
    abn = summary["abn"]
    tax_type = summary["taxType"]
    period_id = summary["period_id"]
    expected = summary["expectedCents"]
    actual = summary["actualCents"]
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO periods (abn, tax_type, period_id, accrued_cents, final_liability_cents, credited_to_owa_cents)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (abn, tax_type, period_id)
            DO UPDATE SET
                accrued_cents = EXCLUDED.accrued_cents,
                final_liability_cents = EXCLUDED.final_liability_cents,
                credited_to_owa_cents = EXCLUDED.credited_to_owa_cents
            """,
            (abn, tax_type, period_id, expected, expected, actual),
        )
        if status == "OK":
            await cur.execute(
                """
                UPDATE periods
                   SET state='CLOSING'
                 WHERE abn=%s AND tax_type=%s AND period_id=%s
                   AND state IN ('OPEN','CLOSING')
                """,
                (abn, tax_type, period_id),
            )
        else:
            await cur.execute(
                """
                UPDATE periods
                   SET state='BLOCKED_DISCREPANCY'
                 WHERE abn=%s AND tax_type=%s AND period_id=%s
                   AND state NOT IN ('RELEASED','FINALIZED')
                """,
                (abn, tax_type, period_id),
            )


def _normalize_summary(summary: Dict[str, Any]) -> Dict[str, Any]:
    try:
        abn = str(summary["abn"]).strip()
        tax_type = str(summary.get("taxType") or summary.get("tax_type")).upper()
        period = str(summary.get("period_id") or summary.get("period")).strip()
    except Exception as exc:
        raise ValueError("invalid summary identifiers") from exc

    expected = int(summary["expectedCents"])
    actual = int(summary["actualCents"])
    tolerance = int(summary.get("toleranceCents", 0))
    tolerance_bps = int(summary.get("toleranceBps", 0))
    delta_raw = summary.get("deltaCents")
    delta = int(delta_raw) if delta_raw is not None else actual - expected

    return {
        "abn": abn,
        "taxType": tax_type,
        "period_id": period,
        "expectedCents": expected,
        "actualCents": actual,
        "deltaCents": delta,
        "toleranceCents": tolerance,
        "toleranceBps": tolerance_bps,
        "sourceEventId": summary.get("sourceEventId"),
    }


def _status_from_summary(summary: Dict[str, Any]) -> str:
    delta = int(summary.get("deltaCents", summary["actualCents"] - summary["expectedCents"]))
    tolerance = int(summary.get("toleranceCents", 0))
    return "OK" if abs(delta) <= tolerance else "FAIL"


async def _handle_summary(summary: Dict[str, Any]) -> None:
    status = _status_from_summary(summary)

    async def _work(conn: psycopg.AsyncConnection) -> None:
        await _upsert_recon_input(conn, summary)
        await _insert_result(conn, summary, status)
        await _sync_period(conn, summary, status)

    await _run_db(_work)
    RECON_MESSAGES.labels(status=status).inc()


async def _connect_nats() -> NATS:
    backoff, max_backoff = 0.5, 8.0
    while True:
        try:
            nc = NATS()
            await nc.connect(servers=[NATS_URL])
            NATS_CONNECTED.set(1)
            return nc
        except ErrNoServers:
            NATS_CONNECTED.set(0)
        except Exception as exc:
            logger.warning("nats connection failed: %s", exc)
            NATS_CONNECTED.set(0)
        await asyncio.sleep(backoff)
        backoff = min(max_backoff, backoff * 2)


async def _subscribe(nc: NATS) -> None:
    async def _on_msg(msg):
        with RECON_LAT.time():
            data = msg.data or b"{}"
            try:
                summary = orjson.loads(data)
            except Exception:
                RECON_ERRORS.inc()
                logger.error("failed to decode recon summary: %s", data)
                return
            if not isinstance(summary, dict):
                RECON_ERRORS.inc()
                logger.warning("unexpected recon summary type: %s", type(summary))
                return
            required = {"abn", "taxType", "period_id", "expectedCents", "actualCents", "toleranceCents", "deltaCents", "toleranceBps"}
            if not required.issubset(summary.keys()):
                RECON_ERRORS.inc()
                logger.warning("summary missing required keys: %s", summary)
                return
            try:
                normalized = _normalize_summary(summary)
                await _handle_summary(normalized)
            except Exception as exc:
                RECON_ERRORS.inc()
                logger.error("failed to persist recon summary: %s", exc)

    await nc.subscribe(SUBJECT_RECON, cb=_on_msg)
    _ready.set()


@app.get("/healthz")
async def healthz() -> Dict[str, Any]:
    await _run_db(lambda conn: conn.execute("SELECT 1"))
    return {"ok": True, "started": _started.is_set()}


@app.get("/readyz")
async def readyz() -> Dict[str, Any]:
    return {"ready": _ready.is_set()}


@app.get("/metrics")
async def metrics() -> Response:
    payload = generate_latest()
    return Response(payload, media_type=CONTENT_TYPE_LATEST)


@app.post("/recon/status")
async def recon_status(req: ReconStatusRequest) -> Dict[str, Any]:
    async def _fetch(conn: psycopg.AsyncConnection):
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT expected_cents, actual_cents, delta_cents, tolerance_cents, tolerance_bps, status, created_at
                  FROM recon_results
                 WHERE abn=%s AND tax_type=%s AND period_id=%s
              ORDER BY created_at DESC
                 LIMIT 1
                """,
                (req.abn, req.tax_type, req.period_id),
            )
            row = await cur.fetchone()
            return row

    row = await _run_db(_fetch)
    if not row:
        raise HTTPException(status_code=404, detail="RECON_NOT_FOUND")
    expected, actual, delta, tolerance, tolerance_bps, status, created_at = row
    return {
        "abn": req.abn,
        "tax_type": req.tax_type,
        "period_id": req.period_id,
        "expected_cents": int(expected),
        "actual_cents": int(actual),
        "delta_cents": int(delta),
        "tolerance_cents": int(tolerance),
        "tolerance_bps": int(tolerance_bps),
        "status": status,
        "as_of": created_at.isoformat() if created_at else None,
    }


@app.on_event("startup")
async def startup():
    _started.set()

    async def runner():
        global _nc
        _nc = await _connect_nats()
        await _subscribe(_nc)

    asyncio.create_task(runner())


@app.on_event("shutdown")
async def shutdown():
    global _nc, _db_conn
    if _nc and _nc.is_connected:
        try:
            await _nc.drain(timeout=2)
        except Exception:
            pass
        finally:
            try:
                await _nc.close()
            except Exception:
                pass
        NATS_CONNECTED.set(0)
    if _db_conn and not _db_conn.closed:
        try:
            await _db_conn.close()
        except Exception:
            pass
