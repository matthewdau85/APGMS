# apps/services/bank-egress/main.py
from fastapi import FastAPI, HTTPException, Header, Response
from pydantic import BaseModel
import os
import psycopg2
import json
import uuid
import pathlib
import sys

from libs.rpt.rpt import verify

SDK_ROOT = pathlib.Path(__file__).resolve().parents[2] / "libs" / "py-sdk"
if str(SDK_ROOT) not in sys.path:
    sys.path.append(str(SDK_ROOT))

from apgms_sdk.idempotency import IdempotencyStore

app = FastAPI(title="bank-egress")

idem_store = IdempotencyStore()


class EgressReq(BaseModel):
    period_id: str
    rpt: dict


def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"),
        user=os.getenv("PGUSER", "postgres"),
        password=os.getenv("PGPASSWORD", "postgres"),
        dbname=os.getenv("PGDATABASE", "postgres"),
        port=int(os.getenv("PGPORT", "5432")),
    )


@app.post("/egress/remit")
def remit(
    req: EgressReq,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    trace_id: str | None = Header(default=None, alias="X-Trace-Id"),
):
    key = idempotency_key or f"bank-egress:{uuid.uuid4()}"
    trace = trace_id or str(uuid.uuid4())
    outcome = idem_store.ensure(key, allow_existing_pending=True)
    response.headers["Idempotency-Key"] = key
    response.headers["X-Trace-Id"] = trace

    if outcome["outcome"] == "replay":
        cached = outcome["cached"]
        for header, value in cached.headers.items():
            response.headers[header] = value
        if cached.content_type:
            response.headers["content-type"] = cached.content_type
        return cached.body

    if outcome["outcome"] == "failed":
        raise HTTPException(409, {"error": "IDEMPOTENCY_FAILED", "failure_cause": outcome["failure_cause"]})

    if outcome["outcome"] == "in_progress":
        raise HTTPException(409, {"error": "IDEMPOTENCY_IN_PROGRESS"})

    owns_key = outcome["outcome"] == "acquired"

    if "signature" not in req.rpt or not verify({k: v for k, v in req.rpt.items() if k != "signature"}, req.rpt["signature"]):
        if owns_key:
            idem_store.mark_failed(key, "INVALID_SIGNATURE")
        raise HTTPException(400, "invalid RPT signature")

    conn = db()
    cur = conn.cursor()
    cur.execute("SELECT state FROM bas_gate_states WHERE period_id=%s", (req.period_id,))
    row = cur.fetchone()
    if not row or row[0] != "RPT-Issued":
        if owns_key:
            idem_store.mark_failed(key, "GATE_NOT_READY")
        raise HTTPException(409, "gate not in RPT-Issued")

    # Here you would call the real bank API via mTLS. For now, we just log.
    payload = json.dumps({"period_id": req.period_id, "action": "remit"})
    cur.execute("INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ('egress',%s,NULL,NULL)", (payload,))
    cur.execute("UPDATE bas_gate_states SET state='Remitted', updated_at=NOW() WHERE period_id=%s", (req.period_id,))
    conn.commit()
    cur.close()
    conn.close()

    body = {"ok": True}
    if owns_key:
        idem_store.mark_applied(
            key,
            status_code=200,
            body=body,
            headers=dict(response.headers),
            content_type="application/json",
        )
    return body
