# apps/services/bas-gate/main.py
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
import os, psycopg2, json, time

from libs.iam.approvals import (
    ApprovalDeniedError,
    DualControlError,
    MfaRequiredError,
    ensure_dual_control,
)

app = FastAPI(title="bas-gate")


class TransitionReq(BaseModel):
    period_id: str
    target_state: str
    reason_code: str | None = None


def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"),
        user=os.getenv("PGUSER", "postgres"),
        password=os.getenv("PGPASSWORD", "postgres"),
        dbname=os.getenv("PGDATABASE", "postgres"),
        port=int(os.getenv("PGPORT", "5432")),
    )


@app.post("/gate/transition")
def transition(req: TransitionReq, request: Request):
    if req.target_state not in {"Open", "Pending-Close", "Reconciling", "RPT-Issued", "Remitted", "Blocked"}:
        raise HTTPException(400, "invalid state")

    try:
        ensure_dual_control(
            token=request.headers.get("authorization"),
            action="bas-gate.transition",
            subject=request.headers.get("x-apgms-actor") or request.headers.get("x-user-id"),
            resource={"period_id": req.period_id, "target_state": req.target_state},
        )
    except MfaRequiredError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except ApprovalDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except DualControlError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    conn = db(); cur = conn.cursor()
    cur.execute("SELECT hash_this FROM bas_gate_states WHERE period_id=%s", (req.period_id,))
    row = cur.fetchone()
    prev = row[0] if row else None
    payload = json.dumps({"period_id": req.period_id, "state": req.target_state, "ts": int(time.time())}, separators=(",", ":"))
    import libs.audit_chain.chain as ch
    h = ch.link(prev, payload)
    if row:
        cur.execute(
            "UPDATE bas_gate_states SET state=%s, reason_code=%s, updated_at=NOW(), hash_prev=%s, hash_this=%s WHERE period_id=%s",
            (req.target_state, req.reason_code, prev, h, req.period_id),
        )
    else:
        cur.execute(
            "INSERT INTO bas_gate_states(period_id,state,reason_code,hash_prev,hash_this) VALUES (%s,%s,%s,%s,%s)",
            (req.period_id, req.target_state, req.reason_code, prev, h),
        )
    cur.execute(
        "INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ('bas_gate',%s,%s,%s)",
        (payload, prev, h),
    )
    conn.commit(); cur.close(); conn.close()
    return {"ok": True, "hash": h}
