# apps/services/bas-gate/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os, psycopg2, json, time

app = FastAPI(title="bas-gate")

class ReconMeta(BaseModel):
    passed: bool
    reason_code: str | None = None
    anomaly_vector: dict[str, float] | None = None
    thresholds: dict[str, float] | None = None


class TransitionReq(BaseModel):
    period_id: str
    target_state: str
    reason_code: str | None = None
    recon: ReconMeta | None = None

def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST","127.0.0.1"),
        user=os.getenv("PGUSER","postgres"),
        password=os.getenv("PGPASSWORD","postgres"),
        dbname=os.getenv("PGDATABASE","postgres"),
        port=int(os.getenv("PGPORT","5432"))
    )

@app.post("/gate/transition")
def transition(req: TransitionReq):
    if req.target_state not in {"Open","Pending-Close","Reconciling","RPT-Issued","Remitted","Blocked"}:
        raise HTTPException(400, "invalid state")
    target_state = req.target_state
    reason_code = req.reason_code
    if req.recon:
        if not req.recon.passed:
            target_state = "Blocked"
            reason_code = req.recon.reason_code or reason_code
        elif target_state == "Blocked":
            target_state = "Reconciling"
    conn = db(); cur = conn.cursor()
    cur.execute("SELECT hash_this FROM bas_gate_states WHERE period_id=%s", (req.period_id,))
    row = cur.fetchone()
    prev = row[0] if row else None
    payload = {
        "period_id": req.period_id,
        "state": target_state,
        "ts": int(time.time()),
    }
    if req.recon:
        payload["recon"] = {
            "passed": req.recon.passed,
            "reason_code": req.recon.reason_code,
            "anomaly_vector": req.recon.anomaly_vector,
            "thresholds": req.recon.thresholds,
        }
    payload_json = json.dumps(payload, separators=(",",":"))
    import libs.audit_chain.chain as ch
    h = ch.link(prev, payload_json)
    if row:
        cur.execute(
            "UPDATE bas_gate_states SET state=%s, reason_code=%s, updated_at=NOW(), hash_prev=%s, hash_this=%s WHERE period_id=%s",
            (target_state, reason_code, prev, h, req.period_id),
        )
    else:
        cur.execute(
            "INSERT INTO bas_gate_states(period_id,state,reason_code,hash_prev,hash_this) VALUES (%s,%s,%s,%s,%s)",
            (req.period_id, target_state, reason_code, prev, h),
        )
    cur.execute(
        "INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ('bas_gate',%s,%s,%s)",
        (payload_json, prev, h),
    )
    conn.commit(); cur.close(); conn.close()
    return {"ok": True, "hash": h}
