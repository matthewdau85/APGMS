from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

import asyncpg
import orjson
from fastapi import FastAPI, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrNoServers
from prometheus_client import (CONTENT_TYPE_LATEST, Counter, Gauge, Histogram,
                               generate_latest)

from .domains import payg_w as payg_w_mod

logger = logging.getLogger("tax_engine")
logger.setLevel(logging.INFO)
_handler = logging.StreamHandler()
_handler.setFormatter(logging.Formatter('%(message)s'))
logger.addHandler(_handler)

@dataclass
class TraceContext:
  trace_id: str
  span_id: str
  trace_flags: str = "01"
  parent_span_id: Optional[str] = None

  @property
  def traceparent(self) -> str:
    parts = ["00", self.trace_id, self.span_id, self.trace_flags]
    if self.parent_span_id:
      parts.append(self.parent_span_id)
    return "-".join(parts)


def _random_hex(bytes_len: int) -> str:
  import secrets
  return secrets.token_hex(bytes_len)


def parse_traceparent(header: Optional[str]) -> TraceContext:
  if not header:
    return TraceContext(trace_id=_random_hex(16), span_id=_random_hex(8))
  parts = header.split('-')
  if len(parts) < 4:
    return TraceContext(trace_id=_random_hex(16), span_id=_random_hex(8))
  _, trace_id, span_id, trace_flags, *rest = parts
  parent = rest[0] if rest else None
  if len(trace_id) != 32:
    trace_id = _random_hex(16)
  if len(span_id) != 16:
    span_id = _random_hex(8)
  if len(trace_flags) != 2:
    trace_flags = '01'
  return TraceContext(trace_id=trace_id, span_id=span_id, trace_flags=trace_flags, parent_span_id=parent)


def child_context(parent: TraceContext) -> TraceContext:
  return TraceContext(trace_id=parent.trace_id, span_id=_random_hex(8), trace_flags=parent.trace_flags, parent_span_id=parent.span_id)


def log_structured(level: str, message: str, **fields: Any) -> None:
  payload = {
    "level": level,
    "msg": message,
    "timestamp": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    **fields,
  }
  logger.log(getattr(logging, level.upper(), logging.INFO), json.dumps(payload, default=str))


app = FastAPI(title="APGMS Tax Engine")

NATS_URL = os.getenv("NATS_URL", "nats://nats:4222")
SUBJECT_INPUT = os.getenv("SUBJECT_INPUT", "apgms.payments.release.v1")
SUBJECT_OUTPUT = os.getenv("SUBJECT_OUTPUT", "apgms.tax.v1")
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
  db_user = os.getenv("PGUSER", "apgms")
  db_pass = os.getenv("PGPASSWORD", "apgms_pw")
  db_host = os.getenv("PGHOST", "127.0.0.1")
  db_port = os.getenv("PGPORT", "5432")
  db_name = os.getenv("PGDATABASE", "apgms")
  DATABASE_URL = f"postgresql://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"

_nc: Optional[NATS] = None
_db: Optional[asyncpg.Pool] = None
_started = asyncio.Event()
_ready = asyncio.Event()

TAX_REQS = Counter("tax_requests_total", "Total tax requests consumed")
TAX_OUT = Counter("tax_results_total", "Total tax results produced")
NATS_CONNECTED = Gauge("taxengine_nats_connected", "1 if connected to NATS else 0")
CALC_LAT = Histogram("taxengine_calc_seconds", "Calculate latency")
DB_LAT = Histogram("taxengine_db_seconds", "DB persistence latency")


async def ensure_db_pool() -> asyncpg.Pool:
  global _db
  if _db:
    return _db
  _db = await asyncpg.create_pool(DATABASE_URL)
  async with _db.acquire() as conn:
    await conn.execute(
      """
      CREATE TABLE IF NOT EXISTS tax_calc_log (
        id SERIAL PRIMARY KEY,
        trace_id TEXT,
        abn TEXT,
        tax_type TEXT,
        period_id TEXT,
        amount_cents NUMERIC,
        payload JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      )
      """
    )
  return _db


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


async def _persist_result(trace: TraceContext, payload: Dict[str, Any]) -> None:
  pool = await ensure_db_pool()
  async with pool.acquire() as conn:
    async with conn.transaction():
      with DB_LAT.time():
        await conn.execute(
          """
          INSERT INTO tax_calc_log (trace_id, abn, tax_type, period_id, amount_cents, payload)
          VALUES ($1,$2,$3,$4,$5,$6)
          """,
          trace.trace_id,
          payload.get("abn"),
          payload.get("taxType"),
          payload.get("periodId"),
          payload.get("amountCents"),
          json.dumps(payload),
        )


async def _publish_result(nc: NATS, trace: TraceContext, payload: Dict[str, Any]) -> None:
  enriched = dict(payload)
  enriched["traceparent"] = child_context(trace).traceparent
  await nc.publish(SUBJECT_OUTPUT, orjson.dumps(enriched))


async def _handle_message(nc: NATS, data: bytes) -> None:
  try:
    body = orjson.loads(data)
  except Exception:
    log_structured("error", "tax_engine.invalid_json")
    return

  trace = parse_traceparent(body.get("traceparent"))
  TAX_REQS.inc()
  with CALC_LAT.time():
    log_structured(
      "info",
      "tax_engine.message_received",
      trace_id=trace.trace_id,
      abn=body.get("abn"),
      tax_type=body.get("taxType"),
      period=body.get("periodId"),
    )
    await _persist_result(trace, body)
    await _publish_result(nc, trace, body)
    TAX_OUT.inc()
    log_structured(
      "info",
      "tax_engine.message_processed",
      trace_id=trace.trace_id,
      abn=body.get("abn"),
      tax_type=body.get("taxType"),
      period=body.get("periodId"),
    )


async def _subscribe_and_run(nc: NATS):
  async def _on_msg(msg):
    await _handle_message(nc, msg.data or b"{}")

  await nc.subscribe(SUBJECT_INPUT, cb=_on_msg)
  _ready.set()


@app.on_event("startup")
async def startup():
  _started.set()

  async def runner():
    global _nc
    await ensure_db_pool()
    _nc = await _connect_nats_with_retry()
    await _subscribe_and_run(_nc)

  asyncio.create_task(runner())


@app.on_event("shutdown")
async def shutdown():
  global _nc, _db
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
  _nc = None
  if _db:
    await _db.close()
    _db = None


@app.get("/metrics")
def metrics():
  return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/healthz")
def healthz():
  return {"ok": True, "started": _started.is_set()}


@app.get("/readyz")
async def readyz():
  deps = {
    "nats": bool(_nc and _nc.is_connected),
    "db": _db is not None,
  }
  if all(deps.values()) and _ready.is_set():
    return {"ready": True, "dependencies": deps}
  return Response(
    content=json.dumps({"ready": False, "dependencies": deps}),
    media_type="application/json",
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
  )


# --- UI (unchanged) ---
TEMPLATES = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")


@app.get("/ui")
def ui_index(request: Request):
  return TEMPLATES.TemplateResponse("index.html", {"request": request, "title": "PAYG-W Calculator", "badge": "demo"})


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
    "target_net": float(form.get("target_net")) if form.get("target_net") else None,
  }
  with open(os.path.join(os.path.dirname(__file__), "rules", "payg_w_2024_25.json"), "r", encoding="utf-8") as f:
    rules = json.load(f)
  res = payg_w_mod.compute({"payg_w": pw}, rules)
  return TEMPLATES.TemplateResponse("index.html", {"request": request, "title": "PAYG-W Calculator", "result": res, "badge": "demo"})


@app.get("/ui/help")
def ui_help(request: Request):
  return TEMPLATES.TemplateResponse("help.html", {"request": request, "title": "Help", "badge": "demo"})
