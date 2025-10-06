from __future__ import annotations

import asyncio
import os
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrNoServers
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

from .data_store import load_period_payload
from .services.gst import compute_gst
from .services.paygw import WithholdingResult, compute_withholding
from .tax_rules import RATES_VERSION

app = FastAPI(title="APGMS Tax Engine")

# Prometheus counters for externally triggered calculations
TAX_EVENTS_PROCESSED = Counter(
    "tax_events_processed_total",
    "Total tax calculation events processed",
)

# Internal NATS wiring
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
def metrics() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/healthz")
def healthz() -> Dict[str, bool]:
    return {"ok": True, "started": _started.is_set()}


@app.get("/readyz")
def readyz():
    if _ready.is_set():
        return {"ready": True}
    return Response(
        content='{"ready": false}',
        media_type="application/json",
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


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


async def _subscribe_and_run(nc: NATS) -> None:
    async def _on_msg(msg):
        with CALC_LAT.time():
            TAX_REQS.inc()
            data = msg.data or b"{}"
            # Placeholder for real calculation fan-out
            await nc.publish(SUBJECT_OUTPUT, data)
            TAX_OUT.inc()

    await nc.subscribe(SUBJECT_INPUT, cb=_on_msg)
    _ready.set()


@app.on_event("startup")
async def startup() -> None:
    _started.set()

    async def runner():
        global _nc
        _nc = await _connect_nats_with_retry()
        await _subscribe_and_run(_nc)

    asyncio.create_task(runner())


@app.on_event("shutdown")
async def shutdown() -> None:
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


# Mini UI wiring -------------------------------------------------------------
TEMPLATES = None
try:
    TEMPLATES = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))
    app.mount(
        "/static",
        StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")),
        name="static",
    )
except AssertionError:
    TEMPLATES = None

if TEMPLATES is not None:

    @app.get("/ui")
    def ui_index(request: Request):
        return TEMPLATES.TemplateResponse(
            "index.html",
            {"request": request, "title": "PAYG-W Calculator", "badge": "demo", "rates_version": RATES_VERSION},
        )


    @app.post("/ui/calc")
    async def ui_calc(request: Request):
        form = await request.form()
        period = (form.get("period") or "weekly").lower()
        residency = (form.get("residency") or "resident").lower()
        gross = float(form.get("gross") or 0)
        flags = {
            "tax_free_threshold": form.get("tft") == "true",
            "stsl": form.get("stsl") == "true",
        }
        result = compute_withholding(gross, period, residency, flags)
        context = {
            "request": request,
            "title": "PAYG-W Calculator",
            "result": result.to_dict(),
            "badge": "demo",
            "rates_version": RATES_VERSION,
        }
        return TEMPLATES.TemplateResponse("index.html", context)


    @app.get("/ui/help")
    def ui_help(request: Request):
        return TEMPLATES.TemplateResponse(
            "help.html",
            {"request": request, "title": "Help", "badge": "demo", "rates_version": RATES_VERSION},
        )


# REST API ------------------------------------------------------------------
def _round_bas(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


@app.get("/tax/{abn}/{period_id}/totals")
def period_totals(abn: str, period_id: str):
    try:
        payload = load_period_payload(abn, period_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Period not found") from exc

    payroll_entries: List[Dict[str, object]] = payload.get("payroll", []) or []
    transactions = payload.get("transactions", []) or []

    withholding_results: List[WithholdingResult] = []
    w1_total = Decimal("0")
    w2_total = Decimal("0")

    for entry in payroll_entries:
        result = compute_withholding(
            gross=float(entry.get("gross", 0) or 0),
            period=str(entry.get("period", "weekly")),
            residency=str(entry.get("residency", "resident")),
            flags=dict(entry.get("flags", {})),
        )
        withholding_results.append(result)
        w1_total += Decimal(str(result.gross))
        w2_total += Decimal(str(result.withheld))

    gst_summary = compute_gst(period_id, transactions)

    labels = dict(gst_summary.labels)
    labels["W1"] = float(_round_bas(w1_total))
    labels["W2"] = float(_round_bas(w2_total))

    response = {
        "abn": abn,
        "period": period_id,
        "rates_version": RATES_VERSION,
        "withholding": [r.to_dict() for r in withholding_results],
        "gst": gst_summary.totals,
        "labels": labels,
        "W1": labels["W1"],
        "W2": labels["W2"],
        "1A": labels.get("1A", 0.0),
        "1B": labels.get("1B", 0.0),
        "net_gst": gst_summary.net_amount(),
    }
    return response
