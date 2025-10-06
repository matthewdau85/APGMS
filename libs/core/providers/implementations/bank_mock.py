"""Mock bank egress provider for Python services."""
from __future__ import annotations

import asyncio
import hashlib
import os
import uuid
from typing import Any

from libs.core.ports import PayoutReference, PayoutResult, RPT


class MockBankEgress:
    def __init__(self) -> None:
        self._latency_ms = max(0, int(os.getenv("MOCK_BANK_LATENCY_MS", "25")))
        self._failure_rate = float(os.getenv("MOCK_BANK_FAILURE_RATE", "0"))

    async def payout(self, rpt: RPT, amount_cents: int, ref: PayoutReference) -> PayoutResult:
        if self._failure_rate and self._failure_rate > 0:
            import random

            if random.random() < min(1.0, max(0.0, self._failure_rate)):
                raise RuntimeError("Mock bank failure triggered by failure rate")

        transfer_uuid = str(uuid.uuid4())
        provider_receipt_id = str(uuid.uuid4())
        reference = f"{ref.get('periodId', 'unknown')}:{transfer_uuid}"
        digest = hashlib.sha256((provider_receipt_id + reference).encode()).hexdigest()

        if self._latency_ms:
            await asyncio.sleep(self._latency_ms / 1000)

        return PayoutResult(
            transferUuid=transfer_uuid,
            bankReceiptHash=digest,
            providerReceiptId=provider_receipt_id,
            rawResponse={
                "reference": reference,
                "amount_cents": amount_cents,
                "port": "mock",
            },
        )
