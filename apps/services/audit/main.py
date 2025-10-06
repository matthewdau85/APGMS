# apps/services/audit/main.py
from fastapi import FastAPI
import os, psycopg2, json

from libs.observability import instrument_app

app = FastAPI(title="audit")
instrument_app(app, "audit")

def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST","127.0.0.1"),
        user=os.getenv("PGUSER","postgres"),
        password=os.getenv("PGPASSWORD","postgres"),
        dbname=os.getenv("PGDATABASE","postgres"),
        port=int(os.getenv("PGPORT","5432"))
    )

@app.get("/audit/bundle/{period_id}")
def bundle(period_id: str):
    conn = db(); cur = conn.cursor()
    cur.execute("SELECT rpt_json, rpt_sig, issued_at FROM rpt_store WHERE period_id=%s ORDER BY issued_at DESC LIMIT 1", (period_id,))
    rpt = cur.fetchone()
    cur.execute("SELECT event_time, category, message FROM audit_log WHERE message LIKE %s ORDER BY event_time", (f'%\"period_id\":\"{period_id}\"%',))
    logs = [{"event_time": str(r[0]), "category": r[1], "message": r[2]}] if cur.rowcount else []
    cur.close(); conn.close()
    return {"period_id": period_id, "rpt": rpt[0] if rpt else None, "audit": logs}
