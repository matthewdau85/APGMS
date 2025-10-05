# apps/services/bank-egress/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os, psycopg2, json
from libs.rpt.rpt import verify

app = FastAPI(title="bank-egress")

class EgressReq(BaseModel):
    period_id: str
    rpt: dict

def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST","127.0.0.1"),
        user=os.getenv("PGUSER","postgres"),
        password=os.getenv("PGPASSWORD","postgres"),
        dbname=os.getenv("PGDATABASE","postgres"),
        port=int(os.getenv("PGPORT","5432"))
    )

@app.post("/egress/remit")
def remit(req: EgressReq):
    if "signature" not in req.rpt or not verify({k:v for k,v in req.rpt.items() if k!="signature"}, req.rpt["signature"]):
        raise HTTPException(400, "invalid RPT signature")
    conn = db(); cur = conn.cursor()
    cur.execute("SELECT state FROM bas_gate_states WHERE period_id=%s", (req.period_id,))
    row = cur.fetchone()
    if not row or row[0] != "RPT-Issued":
        raise HTTPException(409, "gate not in RPT-Issued")
    # Here you would call the real bank API via mTLS. For now, we just log.
    payload = json.dumps({"period_id": req.period_id, "action": "remit"})
    cur.execute("INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ('egress',%s,NULL,NULL)", (payload,))
    cur.execute("UPDATE bas_gate_states SET state='Remitted', updated_at=NOW() WHERE period_id=%s", (req.period_id,))
    conn.commit(); cur.close(); conn.close()
    return {"ok": True}
