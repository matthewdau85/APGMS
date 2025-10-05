# apps/services/bank-egress/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, Literal, Optional
import os, psycopg2, json, uuid, hashlib, logging
import requests

from libs.rpt.rpt import verify
from libs.audit_chain.chain import link

app = FastAPI(title="bank-egress")


class Destination(BaseModel):
    rail: Literal["EFT", "BPAY", "PAYTO"]
    reference: str
    bpay_biller: Optional[str] = None
    account_bsb: Optional[str] = None
    account_number: Optional[str] = None
    mandate_id: Optional[str] = None


class EgressReq(BaseModel):
    period_id: str
    abn: str
    tax_type: Literal["PAYGW", "GST"]
    amount_cents: int
    destination: Destination
    rpt: Dict[str, Any]


class BankApiError(RuntimeError):
    pass


class BankApiClient:
    def __init__(self) -> None:
        self.base_url = os.getenv("BANK_API_BASE", "https://bank.local")
        self.timeout = float(os.getenv("BANK_TIMEOUT_SECONDS", "10"))
        self.session = requests.Session()

        cert = os.getenv("BANK_TLS_CERT")
        key = os.getenv("BANK_TLS_KEY")
        ca = os.getenv("BANK_TLS_CA")
        if cert and key:
            self.session.cert = (cert, key)
        if ca:
            self.session.verify = ca
        api_key = os.getenv("BANK_API_KEY")
        if api_key:
            self.session.headers["Authorization"] = f"Bearer {api_key}"

    def _post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        headers = {"Idempotency-Key": str(uuid.uuid4())}
        resp = self.session.post(url, json=payload, headers=headers, timeout=self.timeout)
        if resp.status_code >= 400:
            raise BankApiError(f"{resp.status_code}: {resp.text.strip()}")
        try:
            return resp.json()
        except ValueError as exc:  # pragma: no cover - defensive
            raise BankApiError("invalid JSON from bank API") from exc

    def eft(self, amount_cents: int, dest: Destination, meta: Dict[str, Any]) -> Dict[str, Any]:
        payload = {
            "amount_cents": amount_cents,
            "destination": {
                "bsb": dest.account_bsb,
                "account": dest.account_number,
            },
            "meta": meta,
        }
        return self._post("/payments/eft", payload)

    def bpay(self, amount_cents: int, dest: Destination, meta: Dict[str, Any]) -> Dict[str, Any]:
        payload = {
            "amount_cents": amount_cents,
            "destination": {
                "biller": dest.bpay_biller,
                "crn": dest.reference,
            },
            "meta": meta,
        }
        return self._post("/payments/bpay", payload)

    def payto(self, amount_cents: int, dest: Destination, meta: Dict[str, Any]) -> Dict[str, Any]:
        payload = {
            "amount_cents": amount_cents,
            "reference": dest.reference,
            "mandate_id": dest.mandate_id,
            "meta": meta,
        }
        return self._post("/payto/debits", payload)


def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"),
        user=os.getenv("PGUSER", "postgres"),
        password=os.getenv("PGPASSWORD", "postgres"),
        dbname=os.getenv("PGDATABASE", "postgres"),
        port=int(os.getenv("PGPORT", "5432")),
    )


def sanitize_numeric(value: Optional[str]) -> str:
    return "" if value is None else "".join(ch for ch in value if ch.isdigit())


def sanitize_reference(value: Optional[str]) -> str:
    return "" if value is None else "".join(value.split())


def ensure_allowlisted(cur, req: EgressReq) -> None:
    dest = req.destination
    if dest.rail == "BPAY":
        cur.execute(
            """
            SELECT 1 FROM remittance_destinations
             WHERE abn=%s AND rail='BPAY' AND reference=%s
             LIMIT 1
            """,
            (req.abn, sanitize_reference(dest.reference)),
        )
        if cur.fetchone() is None:
            raise HTTPException(403, "destination not allow-listed")
        return

    if dest.rail == "EFT":
        bsb = sanitize_numeric(dest.account_bsb)
        acct = sanitize_reference(dest.account_number)
        if not bsb or not acct:
            raise HTTPException(400, "missing EFT banking details")
        cur.execute(
            """
            SELECT 1 FROM remittance_destinations
             WHERE abn=%s AND rail='EFT'
               AND regexp_replace(account_bsb,'[^0-9]','', 'g')=%s
               AND regexp_replace(account_number,'\\s','', 'g')=%s
             LIMIT 1
            """,
            (req.abn, bsb, acct),
        )
        if cur.fetchone() is None:
            raise HTTPException(403, "destination not allow-listed")
        return

    # PAYTO allow-listing may be handled by mandate approval workflows.


def append_audit(cur, actor: str, action: str, payload: Dict[str, Any]) -> str:
    cur.execute("SELECT terminal_hash FROM audit_log ORDER BY seq DESC LIMIT 1")
    row = cur.fetchone()
    prev_hash = row[0] if row else None
    payload_json = json.dumps(payload, separators=(",", ":"))
    payload_hash = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
    h = hashlib.sha256()
    if prev_hash:
        h.update(prev_hash.encode("utf-8"))
    h.update(payload_hash.encode("utf-8"))
    terminal_hash = h.hexdigest()
    cur.execute(
        """
        INSERT INTO audit_log(actor, action, payload_hash, prev_hash, terminal_hash)
        VALUES (%s,%s,%s,%s,%s)
        """,
        (actor, action, payload_hash, prev_hash, terminal_hash),
    )
    return terminal_hash


def transition_gate(cur, period_id: str, target_state: str, reason_code: Optional[str], payload: Dict[str, Any]) -> str:
    cur.execute("SELECT hash_this FROM bas_gate_states WHERE period_id=%s", (period_id,))
    row = cur.fetchone()
    prev = row[0] if row else None
    payload_json = json.dumps(payload, separators=(",", ":"))
    new_hash = link(prev, payload_json)
    if row:
        cur.execute(
            """
            UPDATE bas_gate_states
               SET state=%s, reason_code=%s, updated_at=NOW(), hash_prev=%s, hash_this=%s
             WHERE period_id=%s
            """,
            (target_state, reason_code, prev, new_hash, period_id),
        )
    else:
        cur.execute(
            """
            INSERT INTO bas_gate_states(period_id, state, reason_code, hash_prev, hash_this)
            VALUES (%s,%s,%s,%s,%s)
            """,
            (period_id, target_state, reason_code, prev, new_hash),
        )
    return new_hash


def persist_receipt(cur, req: EgressReq, provider_receipt_id: str, receipt_hash: str) -> None:
    metadata = {
        "rail": req.destination.rail,
        "mandate_id": req.destination.mandate_id,
        "bpay_biller": req.destination.bpay_biller,
    }
    cur.execute(
        """
        INSERT INTO bank_transfer_receipts(
            abn, tax_type, period_id, rail, reference, amount_cents,
            provider_receipt_id, receipt_hash, metadata
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
        ON CONFLICT (provider_receipt_id)
          DO UPDATE SET receipt_hash = EXCLUDED.receipt_hash
        """,
        (
            req.abn,
            req.tax_type,
            req.period_id,
            req.destination.rail,
            sanitize_reference(req.destination.reference),
            req.amount_cents,
            provider_receipt_id,
            receipt_hash,
            json.dumps(metadata),
        ),
    )


def notify_monitoring(event: str, payload: Dict[str, Any]) -> None:
    url = os.getenv("MONITORING_WEBHOOK_URL")
    if not url:
        return
    try:
        requests.post(url, json={"event": event, "payload": payload}, timeout=3)
    except Exception:  # pragma: no cover - monitoring failures should not break flow
        logging.getLogger("bank-egress").warning("monitoring webhook failed", exc_info=True)


client: Optional[BankApiClient] = None


def get_client() -> BankApiClient:
    global client
    if client is None:
        client = BankApiClient()
    return client


@app.post("/egress/remit")
def remit(req: EgressReq):
    rpt_sig = req.rpt.get("signature")
    payload = {k: v for k, v in req.rpt.items() if k != "signature"}
    if not rpt_sig or not verify(payload, rpt_sig):
        raise HTTPException(400, "invalid RPT signature")
    if payload.get("period_id") and payload["period_id"] != req.period_id:
        raise HTTPException(400, "RPT period mismatch")

    conn = db()
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute("SELECT state FROM bas_gate_states WHERE period_id=%s FOR UPDATE", (req.period_id,))
        row = cur.fetchone()
        if not row or row[0] != "RPT-Issued":
            raise HTTPException(409, "gate not in RPT-Issued")

        cur.execute(
            "SELECT final_liability_cents FROM periods WHERE abn=%s AND tax_type=%s AND period_id=%s",
            (req.abn, req.tax_type, req.period_id),
        )
        period = cur.fetchone()
        if period and int(period[0]) != int(req.amount_cents):
            raise HTTPException(400, "amount mismatch with period")

        ensure_allowlisted(cur, req)

        bank_client = get_client()
        meta = {
            "abn": req.abn,
            "tax_type": req.tax_type,
            "period_id": req.period_id,
            "nonce": payload.get("nonce"),
        }

        if req.destination.rail == "EFT":
            bank_resp = bank_client.eft(req.amount_cents, req.destination, meta)
        elif req.destination.rail == "BPAY":
            bank_resp = bank_client.bpay(req.amount_cents, req.destination, meta)
        else:
            bank_resp = bank_client.payto(req.amount_cents, req.destination, meta)

        provider_receipt_id = (
            bank_resp.get("receipt_id")
            or bank_resp.get("bank_ref")
            or bank_resp.get("reference")
        )
        if not provider_receipt_id:
            raise BankApiError("missing receipt identifier")

        receipt_hash = hashlib.sha256(str(provider_receipt_id).encode("utf-8")).hexdigest()
        persist_receipt(cur, req, str(provider_receipt_id), receipt_hash)

        gate_payload = {
            "period_id": req.period_id,
            "state": "Remitted",
            "receipt_hash": receipt_hash,
        }
        transition_gate(cur, req.period_id, "Remitted", None, gate_payload)

        audit_payload = {
            "period_id": req.period_id,
            "rail": req.destination.rail,
            "amount_cents": req.amount_cents,
            "receipt_hash": receipt_hash,
        }
        append_audit(cur, "bank-egress", "remit", audit_payload)

        conn.commit()
        return {
            "ok": True,
            "receipt_hash": receipt_hash,
            "provider_receipt_id": provider_receipt_id,
        }

    except BankApiError as exc:
        conn.rollback()
        failure_payload = {
            "period_id": req.period_id,
            "rail": req.destination.rail,
            "error": str(exc),
        }
        transition_gate(cur, req.period_id, "Blocked", "BANK_FAILURE", failure_payload)
        append_audit(cur, "bank-egress", "remit_failed", failure_payload)
        conn.commit()
        notify_monitoring("bank_egress_failure", failure_payload)
        raise HTTPException(502, "bank transfer failed")
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:  # pragma: no cover - defensive path
        conn.rollback()
        failure_payload = {
            "period_id": req.period_id,
            "rail": req.destination.rail,
            "error": str(exc),
        }
        transition_gate(cur, req.period_id, "Blocked", "UNEXPECTED_FAILURE", failure_payload)
        append_audit(cur, "bank-egress", "remit_failed", failure_payload)
        conn.commit()
        notify_monitoring("bank_egress_failure", failure_payload)
        raise HTTPException(500, "unexpected remit failure")
    finally:
        cur.close()
        conn.close()
