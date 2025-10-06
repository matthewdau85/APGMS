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

from fastapi import FastAPI, Response, status
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from nats.aio.client import Client as NATS
from nats.aio.errors import ErrNoServers

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

# --- BEGIN MINI_UI ---
import json
import os
from datetime import date, timedelta
from functools import lru_cache
from typing import Any, Dict, Optional as TypingOptional

from fastapi import Body, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from .domains import payg_w as payg_w_mod

MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "rules_manifest.json")


@lru_cache(maxsize=1)
def _load_manifest() -> Dict[str, Any]:
    with open(MANIFEST_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _manifest_copy() -> Dict[str, Any]:
    # json round-trip gives us a cheap deep copy without importing copy
    return json.loads(json.dumps(_load_manifest()))


def _parse_iso_date(value: str) -> TypingOptional[date]:
    try:
        return date.fromisoformat(value)
    except Exception:
        return None


_PERIOD_WINDOWS = {
    "weekly": 7,
    "fortnightly": 14,
    "monthly": 31,
}


def _effective_entries_sorted(manifest: Dict[str, Any]):
    entries = manifest.get("effective_periods") or []
    enriched = []
    for entry in entries:
        start = _parse_iso_date(str(entry.get("start", "")))
        if not start:
            continue
        enriched.append((start, entry))
    return sorted(enriched, key=lambda item: item[0])


def build_period_notice(period: str, today: TypingOptional[date] = None) -> Dict[str, Any]:
    manifest = _manifest_copy()
    today = today or date.today()
    window_days = _PERIOD_WINDOWS.get(period.lower(), 7)
    window_end = today + timedelta(days=window_days)

    sorted_entries = _effective_entries_sorted(manifest)
    active_entry = None
    next_change = None
    for start, entry in sorted_entries:
        if start <= today:
            active_entry = {"start": start, "entry": entry}
        elif not next_change:
            next_change = {"start": start, "entry": entry}

    warning: TypingOptional[str] = None
    if next_change and window_end >= next_change["start"]:
        next_label = next_change["entry"].get("version") or next_change["entry"].get("file")
        warning = (
            f"The selected {period.lower()} period will span the upcoming rates change "
            f"on {next_change['start'].isoformat()}. Prepare to switch to version "
            f"{next_label}"
        )

    active_period = active_entry["entry"] if active_entry else None
    active_start = active_entry["start"].isoformat() if active_entry else None

    return {
        "rates_version": manifest.get("rates_version"),
        "source": manifest.get("source", {}),
        "active_period": active_period,
        "active_start": active_start,
        "next_change": next_change["entry"] if next_change else None,
        "warning": warning,
    }


def _resolve_rules_file(period: str) -> str:
    manifest = _manifest_copy()
    period_lower = period.lower()
    for entry in manifest.get("effective_periods", []):
        if str(entry.get("period", "")).lower() == period_lower and entry.get("file"):
            return os.path.join(os.path.dirname(__file__), "rules", entry["file"])
    # fallback to existing default file
    return os.path.join(os.path.dirname(__file__), "rules", "payg_w_2024_25.json")


def _load_rules(period: str) -> Dict[str, Any]:
    path = _resolve_rules_file(period)
    if not os.path.exists(path):
        raise HTTPException(status_code=500, detail=f"Rules file not found for period '{period}'")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


class PaygwCalcRequest(BaseModel):
    method: str = Field("formula_progressive", description="Calculation method to use")
    period: str = Field("weekly", description="Pay cycle for withholding")
    gross: float = Field(..., ge=0, description="Gross earnings for the period")
    percent: float = Field(0.0, description="Percent rate for percent/flat methods")
    extra: float = Field(0.0, description="Additional flat withholding")
    regular_gross: float = Field(0.0, description="Regular gross amount for bonus calculations")
    bonus: float = Field(0.0, description="Bonus amount for marginal bonus method")
    tax_free_threshold: bool = Field(True, description="Whether the tax-free threshold applies")
    stsl: bool = Field(False, description="Whether HELP/SSL adjustments apply")
    target_net: TypingOptional[float] = Field(
        None,
        description="Target net amount when using net-to-gross solver",
    )

    def to_event(self) -> Dict[str, Any]:
        data = self.dict()
        return {
            "payg_w": {
                "method": data.get("method"),
                "period": data.get("period"),
                "gross": data.get("gross"),
                "percent": data.get("percent"),
                "extra": data.get("extra"),
                "regular_gross": data.get("regular_gross") or data.get("gross"),
                "bonus": data.get("bonus"),
                "tax_free_threshold": data.get("tax_free_threshold"),
                "stsl": data.get("stsl"),
                "target_net": data.get("target_net"),
            }
        }

TEMPLATES = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")


@app.get("/tax/rates")
def tax_rates(period: str = "weekly"):
    manifest = _manifest_copy()
    notice = build_period_notice(period)
    return {
        "rates_version": manifest.get("rates_version"),
        "manifest": manifest,
        "period_notice": notice,
    }


@app.post("/tax/paygw/calc")
def tax_paygw_calc(payload: PaygwCalcRequest = Body(...)):
    period = (payload.period or "weekly").lower()
    event = payload.to_event()
    event["payg_w"]["period"] = period
    rules = _load_rules(period)
    result = payg_w_mod.compute(event, rules)
    notice = build_period_notice(period)
    return {
        "result": result,
        "rates_version": notice.get("rates_version"),
        "period_notice": notice,
    }

@app.get("/ui")
def ui_index(request: Request):
    period = "weekly"
    notice = build_period_notice(period)
    context = {
        "request": request,
        "title": "PAYG-W Calculator",
        "badge": "demo",
        "period_notice": notice,
        "form_values": {"period": period},
    }
    return TEMPLATES.TemplateResponse("index.html", context)

@app.post("/ui/calc")
async def ui_calc(request: Request):
    form = await request.form()
    period = (form.get("period") or "weekly").lower()
    pw = {
        "method": form.get("method"),
        "period": period,
        "gross": float(form.get("gross") or 0),
        "percent": float(form.get("percent") or 0),
        "extra": float(form.get("extra") or 0),
        "regular_gross": float(form.get("gross") or 0),
        "bonus": float(form.get("bonus") or 0),
        "tax_free_threshold": form.get("tft") == "true",
        "stsl": form.get("stsl") == "true",
        "target_net": float(form.get("target_net")) if form.get("target_net") else None
    }
    rules = _load_rules(period)
    res = payg_w_mod.compute({"payg_w": pw}, rules)
    context = {
        "request": request,
        "title": "PAYG-W Calculator",
        "result": res,
        "badge": "demo",
        "period_notice": build_period_notice(period),
        "form_values": pw,
    }
    return TEMPLATES.TemplateResponse("index.html", context)

@app.get("/ui/help")
def ui_help(request: Request):
    return TEMPLATES.TemplateResponse("help.html", {"request": request, "title": "Help", "badge":"demo"})
# --- END MINI_UI ---

