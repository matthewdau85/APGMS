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
import json
import logging
import os
import time
from typing import Any, Dict, Optional

from fastapi import FastAPI, Response, status
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrNoServers

try:
    app  # reuse if exists
except NameError:
    app = FastAPI(title="tax-engine")

LOGGER = logging.getLogger("tax-engine")

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

_PAYGW_RULES: Optional[Dict[str, Any]] = None


def _rules_path() -> str:
    return os.path.join(os.path.dirname(__file__), "rules", "payg_w_2024_25.json")


def _load_paygw_rules() -> Dict[str, Any]:
    global _PAYGW_RULES
    if _PAYGW_RULES is None:
        with open(_rules_path(), "r", encoding="utf-8-sig") as fh:
            _PAYGW_RULES = json.load(fh)
    return _PAYGW_RULES


def _line_amount_cents(line: Dict[str, Any]) -> int:
    if "amount_cents" in line and line["amount_cents"] is not None:
        return int(round(float(line["amount_cents"])))
    if "total_cents" in line and line["total_cents"] is not None:
        return int(round(float(line["total_cents"])))
    qty = int(line.get("qty") or 0)
    unit = int(line.get("unit_price_cents") or 0)
    if qty and unit:
        return qty * unit
    if "amount" in line and line["amount"] is not None:
        return int(round(float(line["amount"]) * 100))
    return 0


def _hash_source(payload: Any) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def process_normalized_event(event: Dict[str, Any]) -> Dict[str, Any]:
    """Transform a normalized tax event into aggregated totals for downstream services."""

    from .domains import payg_w as payg_w_mod  # local import to avoid circulars during startup
    from .tax_rules import gst_line_tax

    payg_section = event.get("payg_w") or {}
    rules = _load_paygw_rules() if payg_section else {}
    payg_result: Dict[str, Any] = {}

    gross_cents = 0
    paygw_cents = 0

    if payg_section:
        payg_result = payg_w_mod.compute({"payg_w": payg_section}, rules)
        gross_val = payg_section.get("gross")
        gross_cents = int(round(float(gross_val) * 100)) if gross_val is not None else int(
            round(float(payg_section.get("gross_cents", 0)))
        )
        gross_cents = max(gross_cents, int(round(float(payg_result.get("gross", 0.0)) * 100)))
        paygw_cents = int(round(float(payg_result.get("withholding", 0.0)) * 100))
    else:
        gross_val = event.get("gross") or event.get("gross_cents", 0)
        if gross_val:
            if "gross_cents" in event:
                gross_cents = int(round(float(event.get("gross_cents", 0))))
            else:
                gross_cents = int(round(float(gross_val) * 100))

    lines = event.get("lines") or []
    taxable_cents = 0
    gst_cents = 0
    for line in lines:
        amount = _line_amount_cents(line)
        taxable_cents += max(0, amount)
        gst_cents += gst_line_tax(amount, (line.get("tax_code") or "GST").upper())

    paygw_total = round(paygw_cents / 100, 2)
    gst_total = round(gst_cents / 100, 2)

    gross_total = round(gross_cents / 100, 2)
    taxable_total = round(taxable_cents / 100, 2)

    expected_paygw_ratio = 0.2
    expected_gst_ratio = 0.1

    paygw_ratio = paygw_total / gross_total if gross_total else 0.0
    gst_ratio = gst_total / taxable_total if taxable_total else 0.0

    delta_paygw = abs(paygw_ratio - expected_paygw_ratio)
    delta_gst = abs(gst_ratio - expected_gst_ratio)
    anomaly_score = round(min(1.0, delta_paygw + delta_gst), 6)
    variance_ratio = max(
        (delta_paygw / expected_paygw_ratio) if expected_paygw_ratio else 0.0,
        (delta_gst / expected_gst_ratio) if expected_gst_ratio else 0.0,
    )

    metrics = {
        "paygw_ratio": round(paygw_ratio, 6),
        "gst_ratio": round(gst_ratio, 6),
        "delta_paygw_ratio": round(delta_paygw, 6),
        "delta_gst_ratio": round(delta_gst, 6),
        "variance_ratio": round(variance_ratio, 6),
    }

    source_digests: Dict[str, str] = {}
    if payg_section:
        source_digests["payroll"] = _hash_source(payg_section)
    if lines:
        source_digests["pos"] = _hash_source(lines)
    if not source_digests:
        source_digests["event"] = _hash_source(event)

    return {
        "id": event.get("id"),
        "entity": event.get("entity"),
        "period": event.get("period"),
        "processed_at": int(time.time()),
        "paygw_total": paygw_total,
        "gst_total": gst_total,
        "gross_paygw": gross_total,
        "taxable_sales_total": taxable_total,
        "paygw_details": payg_result,
        "anomaly": {
            "score": anomaly_score,
            "metrics": metrics,
        },
        "source_digests": source_digests,
    }

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
            data = msg.data or b"{}"
            try:
                event = json.loads(data.decode("utf-8"))
                result = process_normalized_event(event)
                payload = json.dumps(result, separators=(",", ":")).encode("utf-8")
                await nc.publish(SUBJECT_OUTPUT, payload)
                TAX_OUT.inc()
            except Exception as exc:
                LOGGER.exception("Failed to process tax event: %s", exc)
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
            try: await _nc.close()
            except Exception: pass
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
try:
    from fastapi import Request
    from fastapi.templating import Jinja2Templates
    from fastapi.staticfiles import StaticFiles
    from .domains import payg_w as payg_w_mod
    import os, json

    _templates_dir = os.path.join(os.path.dirname(__file__), "templates")
    TEMPLATES = Jinja2Templates(directory=_templates_dir)
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
except AssertionError:
    # Optional UI dependency (jinja2) is not installed in test envs.
    TEMPLATES = None
# --- END MINI_UI ---

