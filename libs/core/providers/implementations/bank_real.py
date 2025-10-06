"""Real bank egress provider shim for Python services."""
from __future__ import annotations

import json
import os
import ssl
import urllib.request
import uuid
from hashlib import sha256
from typing import Any

from libs.core.ports import PayoutReference, PayoutResult, RPT


def _require_flag() -> None:
    flag = os.getenv("BANK_REAL_ENABLED", "").lower()
    if flag not in {"1", "true", "yes"}:
        raise RuntimeError("Real bank provider disabled. Set BANK_REAL_ENABLED=true to enable.")


class RealBankEgress:
    def __init__(self) -> None:
        self._base = os.getenv("BANK_API_BASE")
        if not self._base:
            raise RuntimeError("BANK_API_BASE is required for the real bank provider")

        ctx = ssl.create_default_context()
        ca_path = os.getenv("BANK_TLS_CA")
        if ca_path and os.path.exists(ca_path):
            ctx.load_verify_locations(cafile=ca_path)
        cert_path = os.getenv("BANK_TLS_CERT")
        key_path = os.getenv("BANK_TLS_KEY")
        if cert_path and key_path and os.path.exists(cert_path) and os.path.exists(key_path):
            ctx.load_cert_chain(certfile=cert_path, keyfile=key_path)
        self._ssl_context = ctx

    async def payout(self, rpt: RPT, amount_cents: int, ref: PayoutReference) -> PayoutResult:
        _require_flag()
        transfer_uuid = str(uuid.uuid4())
        payload: dict[str, Any] = {
            "amount_cents": amount_cents,
            "meta": {
                "rpt_id": rpt.get("rpt_id"),
                "abn": ref.get("abn"),
                "taxType": ref.get("taxType"),
                "periodId": ref.get("periodId"),
                "transfer_uuid": transfer_uuid,
            },
            "destination": ref.get("destination", {}),
        }
        idempotency_key = ref.get("idempotencyKey", str(uuid.uuid4()))
        req = urllib.request.Request(
            f"{self._base}/payments/eft-bpay",
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Idempotency-Key": idempotency_key,
            },
        )
        with urllib.request.urlopen(req, context=self._ssl_context, timeout=10) as resp:  # type: ignore[arg-type]
            data = json.loads(resp.read().decode() or "{}")
        receipt = data.get("receipt_id", str(uuid.uuid4()))
        digest = sha256(str(receipt).encode()).hexdigest()
        return PayoutResult(
            transferUuid=transfer_uuid,
            bankReceiptHash=digest,
            providerReceiptId=str(receipt),
            rawResponse=data,
        )
