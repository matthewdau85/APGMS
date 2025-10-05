# apps/services/audit/main.py
from fastapi import FastAPI
import hashlib
import json
import os
import psycopg2
from typing import Any

app = FastAPI(title="audit")

def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"),
        user=os.getenv("PGUSER", "postgres"),
        password=os.getenv("PGPASSWORD", "postgres"),
        dbname=os.getenv("PGDATABASE", "postgres"),
        port=int(os.getenv("PGPORT", "5432")),
    )

def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def parse_message(message: Any) -> Any:
    if isinstance(message, str):
        payload = message.strip()
        if (payload.startswith("{") and payload.endswith("}")) or (payload.startswith("[") and payload.endswith("]")):
            try:
                return json.loads(payload)
            except json.JSONDecodeError:
                return message
        return message
    return message


@app.get("/audit/bundle/{period_id}")
def bundle(period_id: str):
    conn = db()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT abn, tax_type FROM periods WHERE period_id=%s ORDER BY updated_at DESC LIMIT 1",
            (period_id,),
        )
        period_row = cur.fetchone()
        abn = period_row[0] if period_row else None
        tax_type = period_row[1] if period_row else None

        cur.execute(
            "SELECT rpt_json, rpt_sig, issued_at FROM rpt_store WHERE period_id=%s ORDER BY issued_at DESC LIMIT 1",
            (period_id,),
        )
        rpt_row = cur.fetchone()
        rpt_payload = None
        rpt_signature = None
        rpt_issued_at = None
        payload_sha256 = None
        if rpt_row:
            raw_payload = rpt_row[0]
            if isinstance(raw_payload, str):
                try:
                    rpt_payload = json.loads(raw_payload)
                except json.JSONDecodeError:
                    rpt_payload = raw_payload
            else:
                rpt_payload = raw_payload
            rpt_signature = rpt_row[1]
            rpt_issued_at = rpt_row[2]
            payload_sha256 = hashlib.sha256(canonical_json(rpt_payload).encode("utf-8")).hexdigest()

        pattern = f'%"period_id":"{period_id}"%'
        cur.execute(
            "SELECT event_time, category, message, hash_prev, hash_this FROM audit_log WHERE message LIKE %s ORDER BY event_time",
            (pattern,),
        )
        audit_rows = cur.fetchall()
        audit_entries = []
        for row in audit_rows:
            event_time, category, message, hash_prev, hash_this = row
            audit_entries.append(
                {
                    "event_time": event_time.isoformat() if hasattr(event_time, "isoformat") else event_time,
                    "category": category,
                    "message": parse_message(message),
                    "hash_prev": hash_prev,
                    "hash_this": hash_this,
                }
            )
        audit_payload = {
            "entries": audit_entries,
            "head": audit_entries[-1]["hash_this"] if audit_entries else None,
            "tail": audit_entries[0]["hash_prev"] if audit_entries else None,
        }
        rpt_record = None
        if rpt_payload is not None or rpt_signature is not None:
            rpt_record = {
                "payload": rpt_payload,
                "signature": rpt_signature,
                "issued_at": rpt_issued_at.isoformat() if hasattr(rpt_issued_at, "isoformat") else rpt_issued_at,
                "payload_sha256": payload_sha256,
            }
        return {
            "period_id": period_id,
            "abn": abn,
            "tax_type": tax_type,
            "rpt": rpt_record,
            "audit": audit_payload,
        }
    finally:
        cur.close()
        conn.close()
