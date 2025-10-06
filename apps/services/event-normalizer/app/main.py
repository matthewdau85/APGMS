import os
import sys
from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.responses import PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, Gauge, generate_latest

_cursor = Path(__file__).resolve()
for _ in range(6):
    parent = _cursor.parent
    if (parent / "observability.py").exists():
        if str(parent) not in sys.path:
            sys.path.append(str(parent))
        break
    _cursor = parent

from observability import Observability

APP_NAME = "event-normalizer"
app = FastAPI(title=APP_NAME)
observability = Observability(APP_NAME)
observability.install_http_middleware(app)

_RESULT_LABELS = ["service", "version", "env", "outcome"]
if "NORMALIZER_TAX_RESULTS" in globals():  # pragma: no cover
    NORMALIZER_TAX_RESULTS = globals()["NORMALIZER_TAX_RESULTS"]  # type: ignore[assignment]
else:
    NORMALIZER_TAX_RESULTS = Gauge(
        "normalizer_tax_results_total",
        "Count of normalized tax events by outcome",
        _RESULT_LABELS,
    )


@app.on_event("startup")
async def _init_metrics() -> None:
    queue_name = os.getenv("NORMALIZER_DLQ_SUBJECT", "apgms.normalized.dlq")
    observability.set_dlq_depth(queue_name, 0)


def record_result(outcome: str, count: int = 1) -> None:
    NORMALIZER_TAX_RESULTS.labels(outcome=outcome, **observability.service_labels).inc(count)


@app.get("/", response_class=PlainTextResponse)
def root() -> str:
    return f"{APP_NAME} up"


@app.get("/readyz", response_class=PlainTextResponse)
def readyz() -> str:
    return "ok"


@app.get("/metrics")
def metrics() -> Response:
    payload = generate_latest()
    return Response(payload, media_type=CONTENT_TYPE_LATEST)
