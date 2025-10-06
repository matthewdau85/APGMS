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
from typing import Optional

import orjson
from fastapi import FastAPI, Response, status
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrNoServers

from .engine import compute_payg_withholding, compute_tax_event
from .rules.loader import build_rules_version_payload

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


@app.get("/rules/version")
def rules_version():
    """Expose the current rule manifest for auditability."""

    return build_rules_version_payload()

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
            payload_bytes = msg.data or b"{}"
            try:
                event = orjson.loads(payload_bytes)
            except Exception:
                result = {
                    "outcome": "error",
                    "error": "INVALID_PAYLOAD",
                    "rules": build_rules_version_payload(),
                }
            else:
                try:
                    result = compute_tax_event(event)
                except Exception as exc:  # pragma: no cover - defensive
                    result = {
                        "outcome": "error",
                        "error": "CALCULATION_FAILED",
                        "detail": str(exc),
                        "rules": build_rules_version_payload(),
                    }
            await nc.publish(SUBJECT_OUTPUT, orjson.dumps(result))
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

# --- BEGIN MINI_UI ---
from fastapi import Request

templates_available = False

try:
    from fastapi.templating import Jinja2Templates  # type: ignore
    from fastapi.staticfiles import StaticFiles  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    Jinja2Templates = None  # type: ignore
    StaticFiles = None  # type: ignore
else:
    import os

    try:
        TEMPLATES = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))
        app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")
        templates_available = True
    except AssertionError:  # pragma: no cover - optional dependency missing
        templates_available = False

if templates_available:

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
        res = compute_payg_withholding({"payg_w": pw})
        return TEMPLATES.TemplateResponse(
            "index.html",
            {"request": request, "title": "PAYG-W Calculator", "result": res, "badge": "demo"},
        )

    @app.get("/ui/help")
    def ui_help(request: Request):
        return TEMPLATES.TemplateResponse("help.html", {"request": request, "title": "Help", "badge": "demo"})
else:

    @app.get("/ui")
    def ui_index(_: Request):
        return {"title": "PAYG-W Calculator", "badge": "demo"}

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
        res = compute_payg_withholding({"payg_w": pw})
        return {"title": "PAYG-W Calculator", "result": res, "badge": "demo"}

    @app.get("/ui/help")
    def ui_help(_: Request):
        return {"title": "Help", "badge": "demo"}
# --- END MINI_UI ---

