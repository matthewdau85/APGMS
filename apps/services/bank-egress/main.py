# apps/services/bank-egress/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os, psycopg2, json, uuid
from libs.rpt.rpt import verify

app = FastAPI(title="bank-egress")

DEFAULT_ACTOR = os.getenv("BANK_EGRESS_DEFAULT_ACTOR", "bank-egress-service")


class EgressReq(BaseModel):
    period_id: str
    rpt: dict
    trace_id: str | None = None


def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"),
        user=os.getenv("PGUSER", "postgres"),
        password=os.getenv("PGPASSWORD", "postgres"),
        dbname=os.getenv("PGDATABASE", "postgres"),
        port=int(os.getenv("PGPORT", "5432"))
    )


@app.post("/egress/remit")
def remit(req: EgressReq):
    if "signature" not in req.rpt or not verify({k: v for k, v in req.rpt.items() if k != "signature"}, req.rpt["signature"]):
        raise HTTPException(400, "invalid RPT signature")
    conn = db()
    cur = conn.cursor()
    trace_id = req.trace_id or uuid.uuid4().hex
    try:
        cur.execute("SELECT state FROM bas_gate_states WHERE period_id=%s", (req.period_id,))
        row = cur.fetchone()
        if not row or row[0] != "RPT_ISSUED":
            raise HTTPException(409, "gate not in RPT_ISSUED")
        payload = json.dumps({"period_id": req.period_id, "action": "remit", "trace_id": trace_id})
        cur.execute("SELECT set_config('apgms.actor', %s, true)", (DEFAULT_ACTOR,))
        cur.execute("SELECT set_config('apgms.trace_id', %s, true)", (trace_id,))
        cur.execute("SELECT set_config('apgms.reason', %s, true)", ("release",))
        cur.execute("INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ('egress',%s,NULL,NULL)", (payload,))
        cur.execute("UPDATE bas_gate_states SET state='RELEASED', updated_at=NOW() WHERE period_id=%s", (req.period_id,))
        conn.commit()
        return {"ok": True, "trace_id": trace_id}
    except HTTPException:
        conn.rollback()
        raise
    except psycopg2.Error as exc:
        conn.rollback()
        if getattr(exc, "pgcode", None) == "P0001":
            diag = getattr(exc, "diag", None)
            message = getattr(diag, "message_primary", str(exc)) if diag else str(exc)
            hint = getattr(diag, "hint", None)
            detail = {
                "error": "invalid_transition",
                "message": message,
                "hint": hint or "Gate must be in RPT_ISSUED before release."
            }
            raise HTTPException(status_code=409, detail=detail) from None
        raise HTTPException(status_code=500, detail="database error") from None
    finally:
        cur.close()
        conn.close()
