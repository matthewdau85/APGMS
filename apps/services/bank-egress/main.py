# apps/services/bank-egress/main.py
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import hashlib
import json
import os
from typing import Any, Dict

import httpx
import psycopg2

from libs.audit_chain import chain
from libs.rpt.rpt import verify

app = FastAPI(title="bank-egress")


class EgressReq(BaseModel):
    period_id: str
    rpt: dict


def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"),
        user=os.getenv("PGUSER", "postgres"),
        password=os.getenv("PGPASSWORD", "postgres"),
        dbname=os.getenv("PGDATABASE", "postgres"),
        port=int(os.getenv("PGPORT", "5432")),
    )


_http_client: httpx.Client | None = None


def _client() -> httpx.Client:
    global _http_client
    if _http_client is not None:
        return _http_client

    base_url = os.getenv("BANK_API_BASE")
    if not base_url:
        raise RuntimeError("BANK_API_BASE is not configured")

    timeout = float(os.getenv("BANK_TIMEOUT_SEC") or 0.0)
    if not timeout:
        timeout = float(os.getenv("BANK_TIMEOUT_MS") or 8000) / 1000.0

    verify_path = os.getenv("BANK_TLS_CA")
    cert_path = os.getenv("BANK_TLS_CERT")
    key_path = os.getenv("BANK_TLS_KEY")
    cert = (cert_path, key_path) if cert_path and key_path else None

    _http_client = httpx.Client(
        base_url=base_url,
        timeout=timeout,
        verify=verify_path if verify_path else True,
        cert=cert,
    )
    return _http_client


def _post_bank(payload: Dict[str, Any]) -> Dict[str, Any]:
    resp = _client().post("/bas/remit", json=payload)
    resp.raise_for_status()
    return resp.json()


@app.post("/egress/remit")
def remit(req: EgressReq):
    if "signature" not in req.rpt or not verify(
        {k: v for k, v in req.rpt.items() if k != "signature"}, req.rpt["signature"]
    ):
        raise HTTPException(400, "invalid RPT signature")

    conn = db()
    cur = conn.cursor()
    try:
        cur.execute(
            "SELECT state, hash_this FROM bas_gate_states WHERE period_id=%s",
            (req.period_id,),
        )
        row = cur.fetchone()
        if not row or row[0] != "RPT-Issued":
            raise HTTPException(409, "gate not in RPT-Issued")

        gate_prev_hash = row[1]

        try:
            bank_payload = _post_bank({"period_id": req.period_id, "rpt": req.rpt})
        except httpx.HTTPError as exc:  # pragma: no cover - handled in tests via stub
            raise HTTPException(502, f"bank error: {exc}") from exc

        receipt_value = bank_payload.get("receipt") or bank_payload.get("receipt_id")
        if not receipt_value:
            raise HTTPException(502, "bank response missing receipt")

        receipt_hash = hashlib.sha256(str(receipt_value).encode("utf-8")).hexdigest()
        bank_reference = bank_payload.get("bank_reference") or bank_payload.get("reference")
        if not bank_reference:
            raise HTTPException(502, "bank response missing reference")

        bank_status = str(bank_payload.get("status", "UNKNOWN"))

        cur.execute(
            """
            INSERT INTO bank_remittances(period_id, rpt_json, bank_reference, bank_status, receipt_hash, bank_payload, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,NOW())
            ON CONFLICT (period_id) DO UPDATE
              SET bank_reference=EXCLUDED.bank_reference,
                  bank_status=EXCLUDED.bank_status,
                  receipt_hash=EXCLUDED.receipt_hash,
                  bank_payload=EXCLUDED.bank_payload,
                  updated_at=NOW()
            """,
            (
                req.period_id,
                json.dumps(req.rpt),
                bank_reference,
                bank_status,
                receipt_hash,
                json.dumps(bank_payload),
            ),
        )

        gate_payload = json.dumps(
            {
                "period_id": req.period_id,
                "state": "Remitted",
                "receipt_hash": receipt_hash,
            },
            separators=(",", ":"),
        )
        new_gate_hash = chain.link(gate_prev_hash, gate_payload)

        cur.execute(
            """
            UPDATE bas_gate_states
               SET state='Remitted',
                   reason_code=%s,
                   updated_at=NOW(),
                   hash_prev=%s,
                   hash_this=%s
             WHERE period_id=%s
            """,
            ("BANK_OK", gate_prev_hash, new_gate_hash, req.period_id),
        )

        cur.execute(
            "SELECT hash_this FROM audit_log WHERE category='egress' ORDER BY id DESC LIMIT 1"
        )
        audit_prev = cur.fetchone()
        prev_hash = audit_prev[0] if audit_prev and audit_prev[0] else None

        audit_payload = json.dumps(
            {
                "period_id": req.period_id,
                "bank_reference": bank_reference,
                "receipt_hash": receipt_hash,
                "status": bank_status,
            },
            separators=(",", ":"),
        )
        audit_hash = chain.link(prev_hash, audit_payload)

        cur.execute(
            "INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES (%s,%s,%s,%s)",
            ("egress", audit_payload, prev_hash, audit_hash),
        )

        conn.commit()
        return JSONResponse(
            {
                "ok": True,
                "bank_reference": bank_reference,
                "receipt_hash": receipt_hash,
                "status": bank_status,
            }
        )
    finally:
        cur.close()
        conn.close()

