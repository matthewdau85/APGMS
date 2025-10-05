# apps/services/bank-egress/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os, psycopg2, json, time
from datetime import datetime, timezone
from psycopg2 import errors
from libs.rpt import ReplayError, SignatureError, TokenExpiredError, decode, verify

app = FastAPI(title="bank-egress")

class EgressReq(BaseModel):
    period_id: str
    rpt: str


class VerifyReq(BaseModel):
    token: str

def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST","127.0.0.1"),
        user=os.getenv("PGUSER","postgres"),
        password=os.getenv("PGPASSWORD","postgres"),
        dbname=os.getenv("PGDATABASE","postgres"),
        port=int(os.getenv("PGPORT","5432"))
    )

def _record_jti(cur, conn, jti: str, exp_dt: datetime) -> bool:
    try:
        cur.execute("INSERT INTO rpt_jti(jti, exp) VALUES (%s,%s)", (jti, exp_dt))
        return True
    except errors.UniqueViolation:
        conn.rollback()
        return False


@app.post("/egress/remit")
def remit(req: EgressReq):
    conn = db(); cur = conn.cursor()
    try:
        def remember(jti: str, exp_dt: datetime) -> bool:
            return _record_jti(cur, conn, jti, exp_dt)

        try:
            claims = verify(req.rpt, jti_store=remember)
        except ReplayError:
            raise HTTPException(409, "rpt replayed")
        except TokenExpiredError:
            raise HTTPException(400, "rpt expired")
        except SignatureError:
            raise HTTPException(400, "invalid RPT signature")

        if claims.get("period_id") != req.period_id:
            raise HTTPException(400, "period mismatch")

        cur.execute("SELECT state FROM bas_gate_states WHERE period_id=%s", (req.period_id,))
        row = cur.fetchone()
        if not row or row[0] != "RPT-Issued":
            raise HTTPException(409, "gate not in RPT-Issued")
        payload = json.dumps({"period_id": req.period_id, "action": "remit"})
        cur.execute("INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ('egress',%s,NULL,NULL)", (payload,))
        cur.execute("UPDATE bas_gate_states SET state='Remitted', updated_at=NOW() WHERE period_id=%s", (req.period_id,))
        conn.commit()
        return {
            "ok": True,
            "jti": claims.get("jti"),
            "exp": datetime.fromtimestamp(claims["exp"], tz=timezone.utc).isoformat(),
        }
    finally:
        cur.close(); conn.close()


@app.post("/rpt/verify")
def rpt_verify(req: VerifyReq):
    try:
        payload = verify(req.token, now=int(time.time()))
        decoded = decode(req.token)
        return {"valid": True, "payload": payload, "header": decoded["header"]}
    except TokenExpiredError:
        raise HTTPException(400, "rpt expired")
    except SignatureError:
        raise HTTPException(400, "invalid RPT signature")
