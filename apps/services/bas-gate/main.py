# apps/services/bas-gate/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os, psycopg2, json, time, uuid

app = FastAPI(title="bas-gate")

VALID_STATES = {"OPEN", "RECONCILING", "RPT_ISSUED", "RELEASED", "BLOCKED"}
DEFAULT_ACTOR = os.getenv("BAS_GATE_DEFAULT_ACTOR", "bas-gate-service")


class TransitionReq(BaseModel):
    period_id: str
    target_state: str
    reason_code: str | None = None
    actor: str | None = None
    trace_id: str | None = None


def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"),
        user=os.getenv("PGUSER", "postgres"),
        password=os.getenv("PGPASSWORD", "postgres"),
        dbname=os.getenv("PGDATABASE", "postgres"),
        port=int(os.getenv("PGPORT", "5432"))
    )


@app.post("/gate/transition")
def transition(req: TransitionReq):
    target_state = req.target_state.upper()
    if target_state not in VALID_STATES:
        raise HTTPException(400, "invalid state")

    actor = req.actor or DEFAULT_ACTOR
    trace_id = req.trace_id or uuid.uuid4().hex

    conn = db()
    cur = conn.cursor()
    try:
        cur.execute("SELECT hash_this FROM bas_gate_states WHERE period_id=%s", (req.period_id,))
        row = cur.fetchone()
        prev = row[0] if row else None
        payload = json.dumps({"period_id": req.period_id, "state": target_state, "ts": int(time.time())}, separators=(",", ":"))
        import libs.audit_chain.chain as ch
        h = ch.link(prev, payload)

        cur.execute("SELECT set_config('apgms.actor', %s, true)", (actor,))
        cur.execute("SELECT set_config('apgms.trace_id', %s, true)", (trace_id,))
        cur.execute("SELECT set_config('apgms.reason', %s, true)", (req.reason_code or "",))

        if row:
            cur.execute(
                "UPDATE bas_gate_states SET state=%s, reason_code=%s, updated_at=NOW(), hash_prev=%s, hash_this=%s WHERE period_id=%s",
                (target_state, req.reason_code, prev, h, req.period_id)
            )
        else:
            cur.execute(
                "INSERT INTO bas_gate_states(period_id,state,reason_code,hash_prev,hash_this) VALUES (%s,%s,%s,%s,%s)",
                (req.period_id, target_state, req.reason_code, prev, h)
            )
        cur.execute(
            "INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ('bas_gate',%s,%s,%s)",
            (payload, prev, h)
        )
        conn.commit()
        return {"ok": True, "hash": h, "trace_id": trace_id}
    except psycopg2.Error as exc:
        conn.rollback()
        if getattr(exc, "pgcode", None) == "P0001":
            diag = getattr(exc, "diag", None)
            message = getattr(diag, "message_primary", str(exc)) if diag else str(exc)
            hint = getattr(diag, "hint", None)
            detail = {
                "error": "invalid_transition",
                "message": message,
                "hint": hint or "Check BAS gate state machine policy and resolve blocking conditions."
            }
            raise HTTPException(status_code=409, detail=detail) from None
        raise HTTPException(status_code=500, detail="database error") from None
    finally:
        cur.close()
        conn.close()
