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
import hashlib
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import orjson
import psycopg
from psycopg import conninfo
from psycopg.errors import DatabaseError
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from fastapi import FastAPI, Response, status
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrNoServers

from .domains import payg_w as payg_w_mod
from .tax_rules import gst_line_tax

try:
    app  # reuse if exists
except NameError:
    app = FastAPI(title="tax-engine")

logger = logging.getLogger("apgms.tax_engine")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)

NATS_URL = os.getenv("NATS_URL", "nats://nats:4222")
SUBJECT_INPUT = os.getenv("SUBJECT_INPUT", "apgms.normalized.v1")
SUBJECT_OUTPUT = os.getenv("SUBJECT_OUTPUT", "apgms.tax.v1")

_nc: Optional[NATS] = None
_started = asyncio.Event()
_ready = asyncio.Event()

TAX_REQS = Counter("tax_requests_total", "Total tax requests consumed")
TAX_OUT = Counter("tax_results_total", "Total tax results produced")
NATS_CONNECTED = Gauge("taxengine_nats_connected", "1 if connected to NATS else 0")
CALC_LAT = Histogram("taxengine_calc_seconds", "Calculate latency")

def _pg_conninfo() -> str:
    return conninfo.make_conninfo(
        host=os.getenv("PGHOST", "127.0.0.1"),
        port=os.getenv("PGPORT", "5432"),
        dbname=os.getenv("PGDATABASE", "postgres"),
        user=os.getenv("PGUSER", "postgres"),
        password=os.getenv("PGPASSWORD", "postgres"),
    )

PG_CONNINFO = _pg_conninfo()

def _canonical_event_id(event: Dict[str, Any]) -> str:
    for key in ("event_id", "id", "src_hash", "txn_id"):
        val = event.get(key)
        if val:
            return str(val)
    return hashlib.sha256(orjson.dumps(event, option=orjson.OPT_SORT_KEYS)).hexdigest()

def _pick(event: Dict[str, Any], *keys: str) -> Optional[Any]:
    for key in keys:
        val = event.get(key)
        if val not in (None, ""):
            return val
    return None

_rules_cache: Dict[str, Dict[str, Any]] = {}

def _load_paygw_rules(version: str) -> Dict[str, Any]:
    cached = _rules_cache.get(version)
    if cached is not None:
        return cached
    base = Path(__file__).resolve().parent / "rules"
    candidates = [base / f"payg_w_{version}.json", base / "payg_w_2024_25.json"]
    for path in candidates:
        if path.exists():
            data = orjson.loads(path.read_bytes())
            _rules_cache[version] = data
            return data
    raise FileNotFoundError(f"No PAYG-W rules for {version}")

def _compute_paygw(event: Dict[str, Any], rates_version: str) -> Dict[str, Any]:
    paygw = dict(event.get("payg_w") or {})
    if "gross_cents" in event and "gross_cents" not in paygw:
        paygw["gross_cents"] = event.get("gross_cents")
    if "gross_cents" in paygw:
        try:
            paygw.setdefault("gross", float(paygw["gross_cents"]) / 100.0)
        except Exception:
            paygw.setdefault("gross", 0.0)
    elif "gross" in paygw:
        paygw.setdefault("gross_cents", int(round(float(paygw.get("gross", 0.0)) * 100)))
    else:
        gross = float(event.get("gross") or 0.0)
        paygw["gross"] = gross
        paygw["gross_cents"] = int(round(gross * 100))
    paygw.setdefault("method", paygw.get("method") or "table_ato")
    paygw.setdefault("period", paygw.get("period") or event.get("period") or "weekly")
    rules = _load_paygw_rules(rates_version)
    result = payg_w_mod.compute({"payg_w": paygw}, rules)
    gross_cents = int(round(float(result.get("gross", paygw.get("gross", 0.0))) * 100))
    liability_cents = int(round(float(result.get("withholding", 0.0)) * 100))
    taxable_cents = gross_cents
    return {
        "gross_cents": gross_cents,
        "taxable_cents": taxable_cents,
        "liability_cents": liability_cents,
        "detail": result,
    }

def _compute_gst(event: Dict[str, Any]) -> Dict[str, Any]:
    lines = event.get("lines") or []
    gross = 0
    taxable = 0
    liability = 0
    for line in lines:
        try:
            qty = int(line.get("qty", 1))
            unit = int(line.get("unit_price_cents", 0))
        except Exception:
            qty, unit = 1, 0
        line_total = qty * unit
        gross += line_total
        code = (line.get("tax_code") or "GST").upper()
        if code == "GST":
            taxable += line_total
        liability += gst_line_tax(line_total, code)
    return {
        "gross_cents": gross,
        "taxable_cents": taxable,
        "liability_cents": liability,
        "detail": {"line_count": len(lines)}
    }

async def _select_owa_balance(cur, abn: str, tax_type: str, period_id: str) -> int:
    await cur.execute(
        "SELECT COALESCE(SUM(amount_cents),0)::bigint AS credited FROM owa_ledger WHERE abn=%s AND tax_type=%s AND period_id=%s",
        (abn, tax_type, period_id),
    )
    row = await cur.fetchone()
    return int(row["credited"]) if row else 0

def _build_evidence_payload(meta: Dict[str, str], totals: Dict[str, Any], credited: int) -> Dict[str, Any]:
    liability = int(totals["liability_cents"])
    delta = liability - int(credited)
    updated_at = totals.get("updated_at")
    if hasattr(updated_at, "isoformat"):
        updated_iso = updated_at.isoformat()
    else:
        updated_iso = datetime.now(timezone.utc).isoformat()
    return {
        "abn": meta["abn"],
        "tax_type": meta["tax_type"],
        "period_id": meta["period_id"],
        "rates_version": totals["rates_version"],
        "totals": {
            "gross_cents": int(totals["gross_cents"]),
            "taxable_cents": int(totals["taxable_cents"]),
            "liability_cents": liability,
            "credited_to_owa_cents": int(credited),
            "delta_cents": delta,
            "event_count": int(totals["event_count"]),
        },
        "updated_at": updated_iso,
    }

async def _persist_result(meta: Dict[str, str], event_id: str, computed: Dict[str, Any], raw_event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    conn = await psycopg.AsyncConnection.connect(PG_CONNINFO, row_factory=dict_row)
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO tax_event_results(event_id, abn, tax_type, period_id, rates_version, gross_cents, taxable_cents, liability_cents, event_payload)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (event_id) DO NOTHING
                """,
                (
                    event_id,
                    meta["abn"],
                    meta["tax_type"],
                    meta["period_id"],
                    meta["rates_version"],
                    int(computed["gross_cents"]),
                    int(computed["taxable_cents"]),
                    int(computed["liability_cents"]),
                    Jsonb(raw_event),
                ),
            )
            inserted = cur.rowcount
            if inserted == 0:
                await cur.execute(
                    """
                    SELECT gross_cents, taxable_cents, liability_cents, event_count, rates_version, evidence_payload, evidence_sha256, updated_at
                    FROM period_tax_totals
                    WHERE abn=%s AND tax_type=%s AND period_id=%s
                    """,
                    (meta["abn"], meta["tax_type"], meta["period_id"]),
                )
                totals = await cur.fetchone()
                credited = await _select_owa_balance(cur, meta["abn"], meta["tax_type"], meta["period_id"])
                await conn.commit()
                if not totals:
                    return None
                return {
                    "inserted": False,
                    "period_totals": totals,
                    "credited_to_owa_cents": credited,
                    "evidence_payload": totals.get("evidence_payload"),
                    "evidence_sha256": totals.get("evidence_sha256"),
                }

            await cur.execute(
                """
                INSERT INTO period_tax_totals(abn, tax_type, period_id, rates_version, gross_cents, taxable_cents, liability_cents, event_count)
                VALUES (%s,%s,%s,%s,%s,%s,%s,1)
                ON CONFLICT (abn, tax_type, period_id) DO UPDATE SET
                  gross_cents = period_tax_totals.gross_cents + EXCLUDED.gross_cents,
                  taxable_cents = period_tax_totals.taxable_cents + EXCLUDED.taxable_cents,
                  liability_cents = period_tax_totals.liability_cents + EXCLUDED.liability_cents,
                  event_count = period_tax_totals.event_count + 1,
                  rates_version = EXCLUDED.rates_version
                RETURNING gross_cents, taxable_cents, liability_cents, event_count, rates_version, updated_at
                """,
                (
                    meta["abn"],
                    meta["tax_type"],
                    meta["period_id"],
                    meta["rates_version"],
                    int(computed["gross_cents"]),
                    int(computed["taxable_cents"]),
                    int(computed["liability_cents"]),
                ),
            )
            totals = await cur.fetchone()
            credited = await _select_owa_balance(cur, meta["abn"], meta["tax_type"], meta["period_id"])
            evidence_payload = _build_evidence_payload(meta, totals, credited)
            evidence_bytes = orjson.dumps(evidence_payload, option=orjson.OPT_SORT_KEYS)
            evidence_hash = hashlib.sha256(evidence_bytes).hexdigest()
            await cur.execute(
                "UPDATE period_tax_totals SET evidence_payload=%s, evidence_sha256=%s WHERE abn=%s AND tax_type=%s AND period_id=%s",
                (
                    Jsonb(evidence_payload),
                    evidence_hash,
                    meta["abn"],
                    meta["tax_type"],
                    meta["period_id"],
                ),
            )
            await cur.execute(
                """
                INSERT INTO periods(abn,tax_type,period_id,state,accrued_cents,credited_to_owa_cents,final_liability_cents,last_rates_version,evidence_sha256)
                VALUES (%s,%s,%s,'OPEN',%s,%s,%s,%s,%s)
                ON CONFLICT (abn,tax_type,period_id) DO UPDATE SET
                  accrued_cents = EXCLUDED.accrued_cents,
                  credited_to_owa_cents = EXCLUDED.credited_to_owa_cents,
                  final_liability_cents = EXCLUDED.final_liability_cents,
                  last_rates_version = EXCLUDED.last_rates_version,
                  evidence_sha256 = EXCLUDED.evidence_sha256
                """,
                (
                    meta["abn"],
                    meta["tax_type"],
                    meta["period_id"],
                    int(totals["liability_cents"]),
                    int(credited),
                    int(totals["liability_cents"]),
                    meta["rates_version"],
                    evidence_hash,
                ),
            )
            await conn.commit()
            return {
                "inserted": True,
                "period_totals": totals,
                "credited_to_owa_cents": credited,
                "evidence_payload": evidence_payload,
                "evidence_sha256": evidence_hash,
            }
    finally:
        await conn.close()

def _extract_meta(event: Dict[str, Any]) -> Dict[str, str]:
    abn = _pick(event, "abn", "entity", "entity_id", "employer_id")
    period = _pick(event, "period_id", "period", "periodId")
    tax_type = _pick(event, "tax_type", "taxType")
    if not tax_type:
        tax_type = "PAYGW" if (event.get("payg_w") or event.get("event_type") == "payroll") else "GST"
    tax_type = str(tax_type).upper()
    rates = _pick(event, "rates_version", "ratesVersion", "rules_version") or "2024-25"
    if not abn or not period:
        raise ValueError("Event missing abn/period metadata")
    return {
        "abn": str(abn),
        "period_id": str(period),
        "tax_type": tax_type,
        "rates_version": str(rates),
    }

async def _process_message(data: bytes) -> Optional[Dict[str, Any]]:
    try:
        event = orjson.loads(data or b"{}")
    except Exception as exc:
        logger.warning("Failed to decode event: %s", exc)
        return None
    try:
        meta = _extract_meta(event)
    except ValueError as exc:
        logger.warning("Dropped event missing metadata: %s", exc)
        return None
    event_id = _canonical_event_id(event)
    if meta["tax_type"] == "PAYGW":
        computed = _compute_paygw(event, meta["rates_version"])
    else:
        computed = _compute_gst(event)
    persisted = await _persist_result(meta, event_id, computed, event)
    if not persisted:
        return None
    persisted.update({
        "meta": meta,
        "event_id": event_id,
        "event_liability_cents": int(computed["liability_cents"]),
    })
    return persisted

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

async def _subscribe_and_run(nc: NATS):
    async def _on_msg(msg):
        with CALC_LAT.time():
            TAX_REQS.inc()
            try:
                result = await _process_message(msg.data or b"{}")
            except DatabaseError as exc:
                logger.exception("Database failure: %s", exc)
                return
            except Exception as exc:
                logger.exception("Processing failure: %s", exc)
                return
            if not result:
                return
            totals = result["period_totals"]
            credited = int(result["credited_to_owa_cents"])
            delta = int(totals["liability_cents"]) - credited
            payload = {
                "abn": result["meta"]["abn"],
                "tax_type": result["meta"]["tax_type"],
                "period_id": result["meta"]["period_id"],
                "rates_version": result["meta"]["rates_version"],
                "event_id": result["event_id"],
                "event_liability_cents": int(result["event_liability_cents"]),
                "period_liability_cents": int(totals["liability_cents"]),
                "period_gross_cents": int(totals["gross_cents"]),
                "period_taxable_cents": int(totals["taxable_cents"]),
                "event_count": int(totals["event_count"]),
                "credited_to_owa_cents": credited,
                "delta_cents": delta,
                "evidence_sha256": result.get("evidence_sha256"),
                "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }
            await nc.publish(SUBJECT_OUTPUT, orjson.dumps(payload))
            TAX_OUT.inc()
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
    global _nc
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

