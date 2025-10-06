# apps/services/bas-gate/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from uuid import UUID
import os, psycopg2, json, time
from psycopg2 import errors

app = FastAPI(title="bas-gate")

class TransitionReq(BaseModel):
    period_id: str
    target_state: str
    reason_code: str | None = None
    actor: str
    trace_id: str
    note: str | None = None

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
    actor = (req.actor or "").strip()
    if not actor:
        raise HTTPException(400, "actor required")
    try:
        trace_uuid = str(UUID(req.trace_id))
    except Exception:
        raise HTTPException(400, "invalid trace_id")
    conn = db()
    cur = conn.cursor()
    try:
        cur.execute("SELECT hash_this FROM bas_gate_states WHERE period_id=%s", (req.period_id,))
        row = cur.fetchone()
        prev = row[0] if row else None
        payload = json.dumps({
            "period_id": req.period_id,
            "state": req.target_state,
            "ts": int(time.time()),
            "actor": actor,
            "reason": req.reason_code,
            "trace_id": trace_uuid,
            "note": req.note,
        }, separators=(",",":"))
        import libs.audit_chain.chain as ch
        h = ch.link(prev, payload)
        if row:
            cur.execute(
                "UPDATE bas_gate_states SET state=%s, reason_code=%s, updated_at=NOW(), hash_prev=%s, hash_this=%s, updated_by=%s, transition_note=%s, trace_id=%s WHERE period_id=%s",
                (req.target_state, req.reason_code, prev, h, actor, req.note, trace_uuid, req.period_id)
            )
        else:
            cur.execute(
                "INSERT INTO bas_gate_states(period_id,state,reason_code,hash_prev,hash_this,updated_by,transition_note,trace_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (req.period_id, req.target_state, req.reason_code, prev, h, actor, req.note, trace_uuid)
            )
        cur.execute("INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ('bas_gate',%s,%s,%s)",
                    (payload, prev, h))
        conn.commit()
    except errors.RaiseException as e:
        conn.rollback()
        raise HTTPException(409, str(e).split("\n")[0])
    except psycopg2.Error as e:
        conn.rollback()
        msg = (e.pgerror or str(e)).split("\n")[0]
        raise HTTPException(500, msg)
    finally:
        cur.close(); conn.close()
    return {"ok": True, "hash": h}
