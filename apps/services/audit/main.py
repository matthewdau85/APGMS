# apps/services/audit/main.py
import os
import psycopg2
import sys
from pathlib import Path

from fastapi import FastAPI

_cursor = Path(__file__).resolve()
for _ in range(6):
    parent = _cursor.parent
    if (parent / "observability.py").exists():
        if str(parent) not in sys.path:
            sys.path.append(str(parent))
        break
    _cursor = parent

from observability import Observability

app = FastAPI(title="audit")
observability = Observability("audit")
observability.install_http_middleware(app)
observability.install_metrics_endpoint(app)

def db():
    conn = psycopg2.connect(
        host=os.getenv("PGHOST","127.0.0.1"),
        user=os.getenv("PGUSER","postgres"),
        password=os.getenv("PGPASSWORD","postgres"),
        dbname=os.getenv("PGDATABASE","postgres"),
        port=int(os.getenv("PGPORT","5432"))
    )
    return observability.instrument_db_connection(conn)

@app.get("/audit/bundle/{period_id}")
def bundle(period_id: str):
    conn = db(); cur = conn.cursor()
    cur.execute("SELECT rpt_json, rpt_sig, issued_at FROM rpt_store WHERE period_id=%s ORDER BY issued_at DESC LIMIT 1", (period_id,))
    rpt = cur.fetchone()
    cur.execute("SELECT event_time, category, message FROM audit_log WHERE message LIKE %s ORDER BY event_time", (f'%\"period_id\":\"{period_id}\"%',))
    logs = [{"event_time": str(r[0]), "category": r[1], "message": r[2]}] if cur.rowcount else []
    cur.close(); conn.close()
    return {"period_id": period_id, "rpt": rpt[0] if rpt else None, "audit": logs}
