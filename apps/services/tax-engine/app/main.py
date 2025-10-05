from __future__ import annotations
from fastapi import FastAPI, Response
from prometheus_client import Counter, generate_latest, CONTENT_TYPE_LATEST

app = FastAPI(title="APGMS Tax Engine")

# Counter you can bump in your message handler
tax_events_processed = Counter(
    "tax_events_processed_total",
    "Total tax calculation events processed"
)

@app.get("/healthz")
def healthz():
    return {"status": "ok"}

# Prometheus metrics endpoint
@app.get("/metrics")
def metrics():
    data = generate_latest()  # default process/python metrics + your counters
    return Response(content=data, media_type=CONTENT_TYPE_LATEST)

# Example: wherever you handle a tax calc event, call:
# tax_events_processed.inc()

# --- BEGIN TAX_ENGINE_CORE_APP ---
import asyncio
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import orjson
import psycopg
from fastapi import FastAPI, Response, status
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrNoServers
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

from .domains import payg_w as payg_w_mod

try:
    app  # reuse if exists
except NameError:
    app = FastAPI(title="tax-engine")

NATS_URL = os.getenv("NATS_URL", "nats://nats:4222")
SUBJECT_INPUT = os.getenv("SUBJECT_INPUT", "apgms.normalized.v1")
SUBJECT_OUTPUT = os.getenv("SUBJECT_OUTPUT", "recon.v1.result")

_nc: Optional[NATS] = None
_started = asyncio.Event()
_ready = asyncio.Event()
_db_conn: Optional[psycopg.AsyncConnection] = None
_db_lock = asyncio.Lock()

if not logging.getLogger().handlers:
    logging.basicConfig(level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO))

logger = logging.getLogger("tax-engine")


def _build_pg_dsn() -> str:
    if url := os.getenv("DATABASE_URL"):
        return url
    host = os.getenv("PGHOST", "postgres")
    user = os.getenv("PGUSER", "apgms")
    password = os.getenv("PGPASSWORD", "apgms_pw")
    database = os.getenv("PGDATABASE", "apgms")
    port = os.getenv("PGPORT", "5432")
    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


PG_DSN = _build_pg_dsn()


def _load_schedules() -> Dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[4]
    schedule_path = repo_root / "src" / "tax" / "schedules.json"
    try:
        data = schedule_path.read_bytes()
        return orjson.loads(data)
    except Exception as exc:  # pragma: no cover - fall back to defaults if missing
        logger.warning("failed to load schedules.json (%s); using baked defaults", exc)
        return {
            "paygw": {
                "tolerance_cents": 50,
                "formula_progressive": {
                    "brackets": [],
                    "period": "weekly",
                },
            },
            "gst": {
                "codes": {"GST": 0.1, "GST_FREE": 0.0},
                "tolerance_cents": 50,
            },
        }


SCHEDULES = _load_schedules()
PAYGW_RULES = SCHEDULES.get("paygw", {})
GST_CODES = (SCHEDULES.get("gst", {}) or {}).get("codes", {})


def _resolve_tolerance(event: Dict[str, Any], tax_type: str) -> int:
    overrides: List[Tuple[str, Any]] = []
    tolerances = event.get("tolerances") or event.get("tolerance") or {}
    if isinstance(tolerances, dict):
        overrides.extend(tolerances.items())
    event_lower = {k.lower(): v for k, v in overrides}
    direct_keys = [
        f"{tax_type.lower()}_tolerance_cents",
        f"{tax_type.lower()}ToleranceCents",
        "tolerance_cents",
        "toleranceCents",
        "epsilon_cents",
    ]
    for key in direct_keys:
        if key in event:
            try:
                return max(0, int(event[key]))
            except Exception:
                continue
    for alias in (tax_type, tax_type.lower()):
        if alias in tolerances:
            try:
                return max(0, int(tolerances[alias]))
            except Exception:
                continue
        if alias.lower() in event_lower:
            try:
                return max(0, int(event_lower[alias.lower()]))
            except Exception:
                continue
    default = 0
    if tax_type.upper() == "PAYGW":
        default = int(PAYGW_RULES.get("tolerance_cents", 0) or 0)
    elif tax_type.upper() == "GST":
        default = int((SCHEDULES.get("gst", {}) or {}).get("tolerance_cents", 0) or 0)
    return max(0, default)


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


async def _select_actual(conn: psycopg.AsyncConnection, abn: str, tax_type: str, period_id: str) -> int:
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT credited_to_owa_cents FROM periods WHERE abn=%s AND tax_type=%s AND period_id=%s",
            (abn, tax_type, period_id),
        )
        row = await cur.fetchone()
        if not row:
            return 0
        value = row[0]
        return int(value) if value is not None else 0


async def _ensure_period(conn: psycopg.AsyncConnection, abn: str, tax_type: str, period_id: str, accrued: int) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO periods (abn, tax_type, period_id, accrued_cents)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (abn, tax_type, period_id)
            DO UPDATE SET accrued_cents = EXCLUDED.accrued_cents
            """,
            (abn, tax_type, period_id, accrued),
        )


async def _upsert_recon_input(
    conn: psycopg.AsyncConnection,
    abn: str,
    tax_type: str,
    period_id: str,
    expected: int,
    tolerance: int,
    actual: int,
) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO recon_inputs (abn, tax_type, period_id, expected_cents, tolerance_cents, actual_cents, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (abn, tax_type, period_id)
            DO UPDATE SET
                expected_cents = EXCLUDED.expected_cents,
                tolerance_cents = EXCLUDED.tolerance_cents,
                actual_cents = EXCLUDED.actual_cents,
                updated_at = NOW()
            """,
            (abn, tax_type, period_id, expected, tolerance, actual),
        )


def _gst_rate_for(code: str) -> float:
    normalized = (code or "GST").upper()
    if normalized in GST_CODES:
        return float(GST_CODES[normalized])
    if "GST" in GST_CODES:
        return float(GST_CODES["GST"])
    return 0.1


def _bps(tolerance_cents: int, expected_cents: int) -> int:
    denom = abs(expected_cents) if expected_cents else 1
    return int(round((tolerance_cents / denom) * 10_000))

TAX_REQS = Counter("tax_requests_total", "Total tax requests consumed")
TAX_OUT = Counter("tax_results_total", "Total tax results produced")
TAX_ERRORS = Counter("tax_results_errors_total", "Tax events that failed processing")
NATS_CONNECTED = Gauge("taxengine_nats_connected", "1 if connected to NATS else 0")
CALC_LAT = Histogram("taxengine_calc_seconds", "Calculate latency")

@app.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/healthz")
def healthz():
    return {"ok": True, "started": _started.is_set()}

@app.get("/readyz")
def readyz():
    if _ready.is_set():
        return {"ready": True}
    return Response('{"ready": false}', status_code=status.HTTP_503_SERVICE_UNAVAILABLE, media_type="application/json")

async def _connect_nats_with_retry() -> NATS:
    backoff, max_backoff = 0.5, 8.0
    while True:
        try:
            nc = NATS()
            await nc.connect(servers=[NATS_URL])
            NATS_CONNECTED.set(1)
            return nc
        except ErrNoServers:
            NATS_CONNECTED.set(0)
        except Exception:
            NATS_CONNECTED.set(0)
        await asyncio.sleep(backoff)
        backoff = min(max_backoff, backoff * 2)

def _extract_abn(event: Dict[str, Any]) -> Optional[str]:
    for key in ("abn", "entity", "entity_id"):
        value = event.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_period(event: Dict[str, Any]) -> Optional[str]:
    for key in ("period_id", "period", "bas_period"):
        value = event.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _compute_paygw(event: Dict[str, Any]) -> Optional[int]:
    payload = event.get("payg_w") or event.get("paygw")
    if not isinstance(payload, dict):
        return None
    try:
        result = payg_w_mod.compute({"payg_w": payload}, PAYGW_RULES)
        withholding = float(result.get("withholding", 0.0))
        return int(round(withholding * 100))
    except Exception as exc:
        logger.warning("paygw compute failed: %s", exc)
        return None


def _compute_gst(event: Dict[str, Any]) -> Optional[int]:
    lines = event.get("lines") or event.get("pos_lines")
    if not isinstance(lines, list) or not lines:
        return None
    total = 0
    for raw_line in lines:
        if not isinstance(raw_line, dict):
            continue
        try:
            qty = int(raw_line.get("qty", 1))
            unit = int(raw_line.get("unit_price_cents", 0))
        except Exception:
            continue
        if qty <= 0 or unit <= 0:
            continue
        amount_cents = qty * unit
        rate = _gst_rate_for(str(raw_line.get("tax_code", "GST")))
        total += int(round(amount_cents * rate))
    return total if total else None


async def _persist_snapshot(abn: str, tax_type: str, period_id: str, expected: int, tolerance: int) -> int:
    async def _work(conn: psycopg.AsyncConnection) -> int:
        await _ensure_period(conn, abn, tax_type, period_id, expected)
        actual = await _select_actual(conn, abn, tax_type, period_id)
        await _upsert_recon_input(conn, abn, tax_type, period_id, expected, tolerance, actual)
        return actual

    return await _run_db(_work)


async def _subscribe_and_run(nc: NATS):
    async def _on_msg(msg):
        with CALC_LAT.time():
            TAX_REQS.inc()
            data = msg.data or b"{}"
            try:
                event = orjson.loads(data)
            except Exception:
                TAX_ERRORS.inc()
                logger.error("failed to decode normalized event: %s", data)
                return

            if not isinstance(event, dict):
                TAX_ERRORS.inc()
                logger.warning("unexpected event type: %s", type(event))
                return

            abn = _extract_abn(event)
            period_id = _extract_period(event)
            if not abn or not period_id:
                TAX_ERRORS.inc()
                logger.warning("event missing abn/period: %s", event)
                return

            tax_work: List[Tuple[str, int, int]] = []

            paygw_expected = _compute_paygw(event)
            if paygw_expected is not None:
                tolerance = _resolve_tolerance(event, "PAYGW")
                tax_work.append(("PAYGW", paygw_expected, tolerance))

            gst_expected = _compute_gst(event)
            if gst_expected is not None:
                tolerance = _resolve_tolerance(event, "GST")
                tax_work.append(("GST", gst_expected, tolerance))

            if not tax_work:
                TAX_ERRORS.inc()
                logger.warning("event %s produced no tax liabilities", event.get("id"))
                return

            for tax_type, expected, tolerance in tax_work:
                try:
                    actual = await _persist_snapshot(abn, tax_type, period_id, expected, tolerance)
                except Exception as exc:
                    TAX_ERRORS.inc()
                    logger.error("db failure for %s %s %s: %s", abn, tax_type, period_id, exc)
                    continue

                delta = actual - expected
                summary = {
                    "abn": abn,
                    "taxType": tax_type,
                    "period_id": period_id,
                    "expectedCents": expected,
                    "actualCents": actual,
                    "deltaCents": delta,
                    "toleranceCents": tolerance,
                    "toleranceBps": _bps(tolerance, expected),
                    "sourceEventId": event.get("id"),
                }

                try:
                    await nc.publish(SUBJECT_OUTPUT, orjson.dumps(summary))
                    TAX_OUT.inc()
                except Exception as exc:
                    TAX_ERRORS.inc()
                    logger.error("failed to publish recon summary: %s", exc)
    await nc.subscribe(SUBJECT_INPUT, cb=_on_msg)
    _ready.set()

@app.on_event("startup")
async def startup():
    _started.set()
    async def runner():
        global _nc
        _nc = await _connect_nats_with_retry()
        await _subscribe_and_run(_nc)
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
            try: await _nc.close()
            except Exception: pass
        NATS_CONNECTED.set(0)
    if _db_conn and not _db_conn.closed:
        try:
            await _db_conn.close()
        except Exception:
            pass
# --- END TAX_ENGINE_CORE_APP ---

# --- BEGIN READINESS_METRICS (tax-engine) ---
try:
    from fastapi import Response, status
    from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
    import asyncio

    _ready_event = globals().get("_ready_event") or asyncio.Event()
    _started_event = globals().get("_started_event") or asyncio.Event()
    globals()["_ready_event"] = _ready_event
    globals()["_started_event"] = _started_event

    @app.get("/metrics")
    def _metrics():
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @app.get("/healthz")
    def _healthz():
        return {"ok": True, "started": _started_event.is_set()}

    @app.get("/readyz")
    def _readyz():
        if _ready_event.is_set():
            return {"ready": True}
        return Response(content='{"ready": false}', media_type="application/json", status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
except Exception:
    pass
# --- END READINESS_METRICS (tax-engine) ---

# --- BEGIN MINI_UI ---
from fastapi import Request
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from .domains import payg_w as payg_w_mod
import os, json

TEMPLATES = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")

@app.get("/ui")
def ui_index(request: Request):
    return TEMPLATES.TemplateResponse("index.html", {"request": request, "title": "PAYG-W Calculator", "badge":"demo"})

@app.post("/ui/calc")
async def ui_calc(request: Request):
    form = await request.form()
    pw = {
        "method": form.get("method"),
        "period": form.get("period"),
        "gross": float(form.get("gross") or 0),
        "percent": float(form.get("percent") or 0),
        "extra": float(form.get("extra") or 0),
        "regular_gross": float(form.get("gross") or 0),
        "bonus": float(form.get("bonus") or 0),
        "tax_free_threshold": form.get("tft") == "true",
        "stsl": form.get("stsl") == "true",
        "target_net": float(form.get("target_net")) if form.get("target_net") else None
    }
    with open(os.path.join(os.path.dirname(__file__), "rules", "payg_w_2024_25.json"), "r", encoding="utf-8") as f:
        rules = json.load(f)
    res = payg_w_mod.compute({"payg_w": pw}, rules)
    return TEMPLATES.TemplateResponse("index.html", {"request": request, "title": "PAYG-W Calculator", "result": res, "badge":"demo"})

@app.get("/ui/help")
def ui_help(request: Request):
    return TEMPLATES.TemplateResponse("help.html", {"request": request, "title": "Help", "badge":"demo"})
# --- END MINI_UI ---

