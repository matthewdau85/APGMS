from fastapi import FastAPI, Response
from fastapi.responses import PlainTextResponse
from typing import Optional
from prometheus_client import REGISTRY, Gauge, generate_latest, CONTENT_TYPE_LATEST
from libs.fixtures import attach_fixture_recorder

APP_NAME = "event-normalizer"
app = FastAPI(title=APP_NAME)
attach_fixture_recorder(app, port_label="event-normalizer")

def _get_or_make_results_gauge() -> Gauge:
    name = "normalizer_tax_results_total"
    help_text = "Count of normalized tax events by outcome"
    # Try to reuse existing collector (avoids Duplicate timeseries on reloads)
    try:
        existing = getattr(REGISTRY, "_names_to_collectors", {})
        if name in existing:
            return existing[name]  # type: ignore[return-value]
    except Exception:
        pass
    try:
        return Gauge(name, help_text, ["outcome"])
    except ValueError:
        existing = getattr(REGISTRY, "_names_to_collectors", {})
        return existing[name]  # type: ignore[return-value]

NORMALIZER_TAX_RESULTS: Gauge = _get_or_make_results_gauge()

def record_result(outcome: str, count: int = 1) -> None:
    NORMALIZER_TAX_RESULTS.labels(outcome=outcome).inc(count)

@app.get("/", response_class=PlainTextResponse)
def root() -> str:
    return f"{APP_NAME} up"

@app.get("/readyz", response_class=PlainTextResponse)
def readyz() -> str:
    return "ok"

@app.get("/metrics")
def metrics() -> Response:
    payload = generate_latest(REGISTRY)
    return Response(payload, media_type=CONTENT_TYPE_LATEST)