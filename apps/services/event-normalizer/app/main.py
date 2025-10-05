from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import PlainTextResponse
from typing import Optional
from prometheus_client import REGISTRY, Gauge, generate_latest, CONTENT_TYPE_LATEST
import os
import psycopg2

from .processors import summarise_period

APP_NAME = "event-normalizer"
app = FastAPI(title=APP_NAME)


def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"),
        user=os.getenv("PGUSER", "postgres"),
        password=os.getenv("PGPASSWORD", "postgres"),
        dbname=os.getenv("PGDATABASE", "postgres"),
        port=int(os.getenv("PGPORT", "5432")),
    )


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


@app.get("/periods/{abn}/{tax_type}/{period_id}")
def period_summary(abn: str, tax_type: str, period_id: str):
    conn = db()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT accrued_cents FROM periods WHERE abn=%s AND tax_type=%s AND period_id=%s",
            (abn, tax_type, period_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="period_not_found")
        baseline = int(row[0] or 0)
        summary = summarise_period(conn, abn, tax_type, period_id, baseline)
        summary["baseline_cents"] = baseline
        record_result("summary", 1)
        return summary
    finally:
        cur.close()
        conn.close()
