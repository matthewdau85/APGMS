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
import os
from typing import Any, Dict, Optional

from fastapi import FastAPI, Response, status, HTTPException
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrNoServers

from .engines import compute_gst as engine_compute_gst, compute_withholding as engine_compute_withholding
from .domains.demo_data import PAYROLL_RUNS
from .rules_manifest import get_bas_labels, get_manifest

try:
    app  # reuse if exists
except NameError:
    app = FastAPI(title="tax-engine")

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
            # TODO: real calc -> publish real result
            await nc.publish(SUBJECT_OUTPUT, data)
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

def _aggregate_paygw(abn: str, period_id: str) -> Dict[str, int]:
    runs = PAYROLL_RUNS.get((abn, period_id), [])
    total_gross = 0
    total_withheld = 0
    for run in runs:
        gross = int(run.get("gross_cents", 0))
        total_gross += gross
        payload = {
            "gross": gross,
            "period": run.get("period", "weekly"),
            "scale": run.get("scale", "resident"),
            "flags": run.get("flags", {"tax_free_threshold": True})
        }
        total_withheld += engine_compute_withholding(payload)
    return {"gross_wages": total_gross, "withheld": total_withheld}


@app.post("/paygw/withholding")
def api_paygw_withholding(payload: Dict[str, Any]):
    try:
        cents = engine_compute_withholding(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"withholding_cents": cents}


@app.post("/gst/summary")
def api_gst_summary(payload: Dict[str, Any]):
    try:
        return engine_compute_gst(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/tax/{abn}/{period_id}/totals")
def api_tax_totals(abn: str, period_id: str):
    bas_labels = get_bas_labels()
    manifest = get_manifest()

    paygw_totals = _aggregate_paygw(abn, period_id)
    gst_result = engine_compute_gst({"abn": abn, "periodId": period_id, "basis": "accrual"})

    labels: Dict[str, int] = {}
    paygw_map = bas_labels.get("paygw", {})
    if paygw_map.get("gross_wages"):
        labels[paygw_map["gross_wages"]] = paygw_totals["gross_wages"]
    if paygw_map.get("withheld"):
        labels[paygw_map["withheld"]] = paygw_totals["withheld"]

    gst_map = bas_labels.get("gst", {})
    for domain_key, label in gst_map.items():
        if domain_key == "taxable_sales":
            labels[label] = gst_result["labels"].get("G1", 0)
        elif domain_key == "gst_free_sales":
            labels[label] = gst_result["labels"].get("G10", 0)
        elif domain_key == "input_taxed_purchases":
            labels[label] = gst_result["labels"].get("G11", 0)
        elif domain_key == "gst_on_sales":
            labels[label] = gst_result["payable"].get("1A", 0)
        elif domain_key == "gst_on_purchases":
            labels[label] = gst_result["credits"].get("1B", 0)

    return {"labels": labels, "rates_version": manifest.get("rates_version")}

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

