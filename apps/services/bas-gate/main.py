# apps/services/bas-gate/main.py
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel
import os, psycopg2, json, time

app = FastAPI(title="bas-gate")

class TransitionReq(BaseModel):
    period_id: str
    target_state: str
    reason_code: str | None = None

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
    conn = db(); cur = conn.cursor()
    cur.execute("SELECT hash_this FROM bas_gate_states WHERE period_id=%s", (req.period_id,))
    row = cur.fetchone()
    prev = row[0] if row else None
    payload = json.dumps({"period_id": req.period_id, "state": req.target_state, "ts": int(time.time())}, separators=(",",":"))
    import libs.audit_chain.chain as ch
    h = ch.link(prev, payload)
    if row:
        cur.execute("UPDATE bas_gate_states SET state=%s, reason_code=%s, updated_at=NOW(), hash_prev=%s, hash_this=%s WHERE period_id=%s",
                    (req.target_state, req.reason_code, prev, h, req.period_id))
    else:
        cur.execute("INSERT INTO bas_gate_states(period_id,state,reason_code,hash_prev,hash_this) VALUES (%s,%s,%s,%s,%s)",
                    (req.period_id, req.target_state, req.reason_code, prev, h))
    cur.execute("INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ('bas_gate',%s,%s,%s)",
                (payload, prev, h))
    conn.commit(); cur.close(); conn.close()
    return {"ok": True, "hash": h}

@app.get("/gate/transition")
def read_transition(period_id: str | None = Query(default=None, alias="periodId"), periodId: str | None = Query(default=None)):
    pid = period_id or periodId
    if not pid:
        raise HTTPException(400, "missing period_id")

    conn = db(); cur = conn.cursor()
    cur.execute("SELECT period_id, state, reason_code, updated_at FROM bas_gate_states WHERE period_id=%s", (pid,))
    row = cur.fetchone()
    cur.close(); conn.close()

    if not row:
        raise HTTPException(404, "period not found")

    period, state, reason_code, updated_at = row
    return {
        "period_id": period,
        "state": state,
        "reason_code": reason_code,
        "updated_at": updated_at.isoformat() if updated_at else None,
    }
