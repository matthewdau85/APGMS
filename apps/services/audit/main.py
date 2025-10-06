# apps/services/audit/main.py
from fastapi import FastAPI
import os, psycopg2, json
from psycopg2.extras import RealDictCursor
from datetime import datetime
from libs.audit_chain.chain import link

app = FastAPI(title="audit")

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
    conn = db(); cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """
            SELECT rpt_json, rpt_sig, issued_at
              FROM rpt_store
             WHERE period_id=%s
             ORDER BY issued_at DESC
             LIMIT 1
            """,
            (period_id,)
        )
        rpt_row = cur.fetchone()
        rpt = None
        if rpt_row:
            rpt = {
                "payload": rpt_row["rpt_json"],
                "signature": rpt_row["rpt_sig"],
                "issued_at": rpt_row["issued_at"].isoformat() if isinstance(rpt_row["issued_at"], datetime) else rpt_row["issued_at"],
            }

        pattern = f'%"period_id":"{period_id}"%'
        cur.execute(
            """
            SELECT id, event_time, category, message, hash_prev, hash_this
              FROM audit_log
             WHERE category IN ('bas_gate','egress')
               AND message LIKE %s
             ORDER BY event_time ASC, id ASC
            """,
            (pattern,)
        )
        rows = cur.fetchall()
        prev_hash: str | None = None
        audit_trail = []
        for row in rows:
            raw_message = row["message"] or ""
            try:
                parsed_message = json.loads(raw_message)
            except Exception:
                parsed_message = raw_message
            computed_hash = link(prev_hash, raw_message)
            audit_trail.append({
                "id": row["id"],
                "event_time": row["event_time"].isoformat() if isinstance(row["event_time"], datetime) else str(row["event_time"]),
                "category": row["category"],
                "message": parsed_message,
                "hash_prev": row["hash_prev"],
                "hash_this": row["hash_this"],
                "hash_computed": computed_hash,
                "trace_id": computed_hash,
                "hash_match": (row["hash_this"] == computed_hash)
            })
            prev_hash = computed_hash

        return {
            "period_id": period_id,
            "rpt": rpt,
            "audit_trail": audit_trail,
            "chain_root": audit_trail[-1]["hash_computed"] if audit_trail else None
        }
    finally:
        cur.close(); conn.close()
