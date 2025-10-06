# apps/services/bas-gate/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os, json, time
from typing import Optional, Tuple

try:  # pragma: no cover - exercised in production, not unit tests
    import psycopg2  # type: ignore
except ImportError:  # pragma: no cover
    psycopg2 = None  # type: ignore

app = FastAPI(title="bas-gate")

class TransitionReq(BaseModel):
    period_id: str
    target_state: str
    reason_code: str | None = None

ALLOWED_TRANSITIONS = {
    None: {"Open"},
    "Open": {"Pending-Close", "Blocked"},
    "Pending-Close": {"Reconciling", "Blocked"},
    "Reconciling": {"RPT-Issued", "Blocked"},
    "RPT-Issued": {"Remitted", "Blocked"},
    "Blocked": {"Reconciling", "Open"},
    "Remitted": set(),
}

REQUIRES_REASON = {"Blocked", "Remitted"}


def db():
    if psycopg2 is None:  # pragma: no cover - ensures explicit failure when driver missing
        raise RuntimeError("psycopg2 not available")
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"),
        user=os.getenv("PGUSER", "postgres"),
        password=os.getenv("PGPASSWORD", "postgres"),
        dbname=os.getenv("PGDATABASE", "postgres"),
        port=int(os.getenv("PGPORT", "5432")),
    )


def _validate_transition(prev_state: Optional[str], prev_reason: Optional[str], req: TransitionReq) -> None:
    allowed = ALLOWED_TRANSITIONS.get(prev_state, set())
    if req.target_state not in allowed:
        raise HTTPException(409, "invalid transition")
    if req.target_state in REQUIRES_REASON and not req.reason_code:
        raise HTTPException(400, "reason required")
    if req.target_state == "Remitted":
        if prev_state != "RPT-Issued":
            raise HTTPException(409, "invalid transition")
        if prev_reason and req.reason_code and prev_reason == req.reason_code:
            raise HTTPException(403, "separation of duties violated")


def _load_state(cur, period_id: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    cur.execute(
        "SELECT state, reason_code, hash_this FROM bas_gate_states WHERE period_id=%s FOR UPDATE",
        (period_id,),
    )
    row = cur.fetchone()
    if not row:
        return None, None, None
    return row[0], row[1], row[2]


@app.post("/gate/transition")
def transition(req: TransitionReq):
    if req.target_state not in {"Open", "Pending-Close", "Reconciling", "RPT-Issued", "Remitted", "Blocked"}:
        raise HTTPException(400, "invalid state")
    conn = db()
    cur = conn.cursor()
    try:
        prev_state, prev_reason, prev_hash = _load_state(cur, req.period_id)
        if prev_state == req.target_state and prev_reason == req.reason_code:
            return {"ok": True, "hash": prev_hash}
        _validate_transition(prev_state, prev_reason, req)
        payload = json.dumps(
            {
                "period_id": req.period_id,
                "state": req.target_state,
                "reason": req.reason_code,
                "ts": int(time.time()),
            },
            separators=(",", ":"),
        )
        import libs.audit_chain.chain as ch

        h = ch.link(prev_hash, payload)
        if prev_state is None:
            cur.execute(
                "INSERT INTO bas_gate_states(period_id,state,reason_code,hash_prev,hash_this) VALUES (%s,%s,%s,%s,%s)",
                (req.period_id, req.target_state, req.reason_code, prev_hash, h),
            )
        else:
            cur.execute(
                "UPDATE bas_gate_states SET state=%s, reason_code=%s, updated_at=NOW(), hash_prev=%s, hash_this=%s WHERE period_id=%s",
                (req.target_state, req.reason_code, prev_hash, h, req.period_id),
            )
        cur.execute(
            "INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ('bas_gate',%s,%s,%s)",
            (payload, prev_hash, h),
        )
        conn.commit()
        return {"ok": True, "hash": h}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
