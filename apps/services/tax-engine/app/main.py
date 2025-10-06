import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request, Response, status
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrNoServers
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

from .domains import payg_w as payg_w_mod

_cursor = Path(__file__).resolve()
for _ in range(6):
    parent = _cursor.parent
    if (parent / "observability.py").exists():
        if str(parent) not in sys.path:
            sys.path.append(str(parent))
        break
    _cursor = parent

from observability import Observability

observability = Observability("tax-engine")
SERVICE_LABELS = observability.service_labels

app = FastAPI(title="tax-engine")
observability.install_http_middleware(app)

_tax_events_processed = Counter(
    "tax_events_processed_total",
    "Total tax calculation events processed",
    ["service", "version", "env"],
).labels(**SERVICE_LABELS)
_tax_requests = Counter(
    "tax_requests_total",
    "Total tax requests consumed",
    ["service", "version", "env"],
).labels(**SERVICE_LABELS)
_tax_results = Counter(
    "tax_results_total",
    "Total tax calculation results produced",
    ["service", "version", "env"],
).labels(**SERVICE_LABELS)
_nats_connected = Gauge(
    "taxengine_nats_connected",
    "1 when the service is connected to NATS",
    ["service", "version", "env"],
).labels(**SERVICE_LABELS)
_calc_latency = Histogram(
    "taxengine_calc_seconds",
    "Time spent producing a tax result",
    ["service", "version", "env"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
).labels(**SERVICE_LABELS)

NATS_URL = os.getenv("NATS_URL", "nats://nats:4222")
SUBJECT_INPUT = os.getenv("SUBJECT_INPUT", "apgms.normalized.v1")
SUBJECT_OUTPUT = os.getenv("SUBJECT_OUTPUT", "apgms.tax.v1")
DLQ_SUBJECT = os.getenv("TAX_ENGINE_DLQ_SUBJECT", "apgms.tax.dlq")

_nc: Optional[NATS] = None
_started = asyncio.Event()
_ready = asyncio.Event()


@app.on_event("startup")
async def _startup() -> None:
    _started.set()
    observability.set_dlq_depth(DLQ_SUBJECT, 0)

    async def runner() -> None:
        global _nc
        _nc = await _connect_nats_with_retry()
        await _subscribe_and_run(_nc)

    asyncio.create_task(runner())


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _nc
    if _nc and _nc.is_connected:
        try:
            await _nc.drain(timeout=2)
        except Exception:  # pragma: no cover - best effort shutdown
            pass
        finally:
            try:
                await _nc.close()
            except Exception:
                pass
        _nats_connected.set(0)


async def _connect_nats_with_retry() -> NATS:
    backoff, max_backoff = 0.5, 8.0
    while True:
        try:
            nc = NATS()
            await nc.connect(servers=[NATS_URL])
            _nats_connected.set(1)
            return nc
        except ErrNoServers:
            _nats_connected.set(0)
        except Exception:
            _nats_connected.set(0)
        await asyncio.sleep(backoff)
        backoff = min(max_backoff, backoff * 2)


async def _subscribe_and_run(nc: NATS) -> None:
    async def _on_msg(msg):
        with _calc_latency.time():
            _tax_requests.inc()
            payload = msg.data or b"{}"
            await nc.publish(SUBJECT_OUTPUT, payload)
            _tax_results.inc()
            _tax_events_processed.inc()

    await nc.subscribe(SUBJECT_INPUT, cb=_on_msg)
    _ready.set()


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True, "started": _started.is_set()}


@app.get("/readyz")
def readyz() -> Response:
    if _ready.is_set():
        return Response(content='{"ready": true}', media_type="application/json")
    return Response(
        content='{"ready": false}',
        media_type="application/json",
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


# --- MINI UI ---------------------------------------------------------------
_templates_dir = os.path.join(os.path.dirname(__file__), "templates")
_static_dir = os.path.join(os.path.dirname(__file__), "static")
TEMPLATES = Jinja2Templates(directory=_templates_dir)
app.mount("/static", StaticFiles(directory=_static_dir), name="static")


@app.get("/ui")
def ui_index(request: Request):
    return TEMPLATES.TemplateResponse(
        "index.html",
        {"request": request, "title": "PAYG-W Calculator", "badge": "demo"},
    )


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
    rules_path = os.path.join(os.path.dirname(__file__), "rules", "payg_w_2024_25.json")
    with open(rules_path, "r", encoding="utf-8") as handle:
    rules = json.load(handle)
    res = payg_w_mod.compute({"payg_w": pw}, rules)
    return TEMPLATES.TemplateResponse(
        "index.html",
        {
            "request": request,
            "title": "PAYG-W Calculator",
            "result": res,
            "badge": "demo",
        },
    )


@app.get("/ui/help")
def ui_help(request: Request):
    return TEMPLATES.TemplateResponse(
        "help.html",
        {"request": request, "title": "Help", "badge": "demo"},
    )
