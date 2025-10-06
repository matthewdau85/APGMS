# apps/services/bas-gate/main.py
import json
import os
import psycopg2
import sys
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

_cursor = Path(__file__).resolve()
for _ in range(6):
    parent = _cursor.parent
    if (parent / "observability.py").exists():
        if str(parent) not in sys.path:
            sys.path.append(str(parent))
        break
    _cursor = parent

from observability import Observability

app = FastAPI(title="bas-gate")
observability = Observability("bas-gate")
observability.install_http_middleware(app)
observability.install_metrics_endpoint(app)

class TransitionReq(BaseModel):
    period_id: str
    target_state: str
    reason_code: str | None = None

def db():
    conn = psycopg2.connect(
        host=os.getenv("PGHOST","127.0.0.1"),
        user=os.getenv("PGUSER","postgres"),
        password=os.getenv("PGPASSWORD","postgres"),
        dbname=os.getenv("PGDATABASE","postgres"),
        port=int(os.getenv("PGPORT","5432"))
    )
    return observability.instrument_db_connection(conn)

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
