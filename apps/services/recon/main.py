# apps/services/recon/main.py
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Dict
import os
import psycopg2
import json
import httpx

app = FastAPI(title="recon")


DEFAULT_THRESHOLDS: Dict[str, float] = {
    "variance_ratio": 0.25,
    "dup_rate": 0.01,
    "gap_minutes": 60.0,
    "delta_vs_baseline": 0.2,
}

EVENT_NORMALIZER_URL = os.getenv("NORMALIZER_URL", "http://event-normalizer:8001")


def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"),
        user=os.getenv("PGUSER", "postgres"),
        password=os.getenv("PGPASSWORD", "postgres"),
        dbname=os.getenv("PGDATABASE", "postgres"),
        port=int(os.getenv("PGPORT", "5432")),
    )


def ensure_tables() -> None:
    conn = db()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS recon_runs (
                id SERIAL PRIMARY KEY,
                abn TEXT NOT NULL,
                tax_type TEXT NOT NULL,
                period_id TEXT NOT NULL,
                passed BOOLEAN NOT NULL,
                reason_code TEXT,
                anomaly_vector JSONB NOT NULL,
                thresholds JSONB NOT NULL,
                total_events INTEGER NOT NULL,
                total_credit_cents BIGINT NOT NULL,
                baseline_cents BIGINT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (abn, tax_type, period_id)
            )
            """
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


ensure_tables()


class ReconReq(BaseModel):
    abn: str
    tax_type: str
    period_id: str
    thresholds: Dict[str, float] | None = None


class ReconResponse(BaseModel):
    passed: bool
    reason_code: str | None
    controls: list[str]
    next_state: str
    anomaly_vector: Dict[str, float]
    thresholds: Dict[str, float]
    totals: Dict[str, Any]


async def fetch_normalized_summary(abn: str, tax_type: str, period_id: str) -> Dict[str, Any]:
    url = f"{EVENT_NORMALIZER_URL}/periods/{abn}/{tax_type}/{period_id}"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="period_not_found")
    resp.raise_for_status()
    return resp.json()


def merge_thresholds(base: Dict[str, float], override: Dict[str, float] | None) -> Dict[str, float]:
    merged = dict(DEFAULT_THRESHOLDS)
    merged.update(base)
    if override:
        merged.update(override)
    return merged


def evaluate(vector: Dict[str, float], thresholds: Dict[str, float]) -> tuple[bool, str | None]:
    checks = [
        (vector.get("variance_ratio", 0.0) <= thresholds["variance_ratio"], "variance_breach"),
        (vector.get("dup_rate", 0.0) <= thresholds["dup_rate"], "duplicate_detected"),
        (vector.get("gap_minutes", 0.0) <= thresholds["gap_minutes"], "gap_detected"),
        (abs(vector.get("delta_vs_baseline", 0.0)) <= thresholds["delta_vs_baseline"], "baseline_delta"),
    ]
    for ok, reason in checks:
        if not ok:
            return False, reason
    return True, None


def persist_result(req: ReconReq, passed: bool, reason: str | None, vector: Dict[str, float], thresholds: Dict[str, float], totals: Dict[str, Any]) -> None:
    conn = db()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO recon_runs(abn, tax_type, period_id, passed, reason_code, anomaly_vector, thresholds, total_events, total_credit_cents, baseline_cents)
            VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s)
            ON CONFLICT (abn, tax_type, period_id) DO UPDATE SET
                passed=EXCLUDED.passed,
                reason_code=EXCLUDED.reason_code,
                anomaly_vector=EXCLUDED.anomaly_vector,
                thresholds=EXCLUDED.thresholds,
                total_events=EXCLUDED.total_events,
                total_credit_cents=EXCLUDED.total_credit_cents,
                baseline_cents=EXCLUDED.baseline_cents,
                created_at=NOW()
            """,
            (
                req.abn,
                req.tax_type,
                req.period_id,
                passed,
                reason,
                json.dumps(vector),
                json.dumps(thresholds),
                int(totals.get("total_events", 0)),
                int(totals.get("total_credit_cents", 0)),
                int(totals.get("baseline_cents", 0)),
            ),
        )
        conn.commit()
    finally:
        cur.close()
        conn.close()


@app.post("/recon/run", response_model=ReconResponse)
async def run(req: ReconReq):
    conn = db()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT thresholds FROM periods WHERE abn=%s AND tax_type=%s AND period_id=%s",
            (req.abn, req.tax_type, req.period_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="period_not_found")
        period_thresholds = row[0] or {}
    finally:
        cur.close()
        conn.close()

    summary = await fetch_normalized_summary(req.abn, req.tax_type, req.period_id)
    totals = {
        "total_events": summary.get("counts", {}).get("total_events", 0),
        "total_credit_cents": summary.get("counts", {}).get("total_credit_cents", 0),
        "baseline_cents": summary.get("baseline_cents", 0),
    }
    anomaly_vector: Dict[str, float] = summary.get("anomaly_vector", {})
    thresholds = merge_thresholds(period_thresholds or {}, req.thresholds)
    passed, reason = evaluate(anomaly_vector, thresholds)
    persist_result(req, passed, reason, anomaly_vector, thresholds, totals)

    controls = ["BAS-GATE", "RPT"] if passed else ["BLOCK"]
    next_state = "Reconciling" if passed else "Blocked"
    return ReconResponse(
        passed=passed,
        reason_code=reason,
        controls=controls,
        next_state=next_state,
        anomaly_vector=anomaly_vector,
        thresholds=thresholds,
        totals=totals,
    )
