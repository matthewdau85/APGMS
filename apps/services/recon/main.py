# apps/services/recon/main.py
from fastapi import FastAPI
from pydantic import BaseModel
import os, psycopg2, json, math, requests, logging

app = FastAPI(title="recon")
logger = logging.getLogger("recon")


def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"),
        user=os.getenv("PGUSER", "postgres"),
        password=os.getenv("PGPASSWORD", "postgres"),
        dbname=os.getenv("PGDATABASE", "postgres"),
        port=int(os.getenv("PGPORT", "5432")),
    )


def persist_result(req: "ReconReq", passed: bool, reason_code: str | None, metrics: dict[str, bool]):
    conn = None
    cur = None
    try:
        conn = db()
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS recon_results (
                id SERIAL PRIMARY KEY,
                period_id TEXT NOT NULL UNIQUE,
                passed BOOLEAN NOT NULL,
                reason_code TEXT,
                payload JSONB NOT NULL,
                metrics JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            INSERT INTO recon_results(period_id, passed, reason_code, payload, metrics)
            VALUES (%s,%s,%s,%s::jsonb,%s::jsonb)
            ON CONFLICT (period_id) DO UPDATE
            SET passed=EXCLUDED.passed,
                reason_code=EXCLUDED.reason_code,
                payload=EXCLUDED.payload,
                metrics=EXCLUDED.metrics,
                updated_at=NOW()
            """,
            (
                req.period_id,
                passed,
                reason_code,
                json.dumps(req.dict()),
                json.dumps(metrics),
            ),
        )
        conn.commit()
        return True, None
    except Exception as exc:
        logger.warning("persist_result failed: %s", exc)
        if conn:
            conn.rollback()
        return False, str(exc)
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


def gate_endpoint() -> str:
    endpoint = os.getenv("BAS_GATE_ENDPOINT")
    if endpoint:
        return endpoint
    base = os.getenv("BAS_GATE_URL")
    if base:
        return base.rstrip("/") + "/gate/transition"
    return "http://localhost:8101/gate/transition"


def publish_gate_event(period_id: str, target_state: str, reason_code: str | None):
    url = gate_endpoint()
    timeout = float(os.getenv("BAS_GATE_TIMEOUT", "2.5"))
    try:
        resp = requests.post(
            url,
            json={
                "period_id": period_id,
                "target_state": target_state,
                "reason_code": reason_code,
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        try:
            body = resp.json()
        except ValueError:
            body = None
        return True, body
    except Exception as exc:
        logger.warning("publish_gate_event failed: %s", exc)
        return False, str(exc)


class ReconReq(BaseModel):
    period_id: str
    paygw_total: float
    gst_total: float
    owa_paygw: float
    owa_gst: float
    anomaly_score: float
    tolerance: float = 0.01


@app.post("/recon/run")
def run(req: ReconReq):
    pay_ok = math.isclose(req.paygw_total, req.owa_paygw, abs_tol=req.tolerance)
    gst_ok = math.isclose(req.gst_total, req.owa_gst, abs_tol=req.tolerance)
    anomaly_ok = req.anomaly_score < 0.8

    passed = pay_ok and gst_ok and anomaly_ok
    reason = None if passed else ("shortfall" if (not pay_ok or not gst_ok) else "anomaly_breach")
    metrics = {"pay_ok": pay_ok, "gst_ok": gst_ok, "anomaly_ok": anomaly_ok}

    persisted, persist_error = persist_result(req, passed, reason, metrics)
    target_state = "RPT-Issued" if passed else "Blocked"
    gate_ok, gate_payload = publish_gate_event(req.period_id, target_state, reason)

    response = {
        "pass": passed,
        "reason_code": reason,
        "controls": ["BAS-GATE", "RPT"] if passed else ["BLOCK"],
        "next_state": target_state,
        "metrics": metrics,
        "persisted": persisted,
        "gate_event": {"ok": gate_ok, "payload": gate_payload if gate_ok else None},
    }
    if persist_error:
        response["persist_error"] = persist_error
    if not gate_ok:
        response["gate_event"]["error"] = gate_payload
        response["gate_event"]["payload"] = None
    return response
