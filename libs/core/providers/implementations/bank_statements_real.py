"""Real bank statements provider wrapper."""
from __future__ import annotations

import json
import os
import ssl
import urllib.request
from typing import Any

from libs.core.ports import IngestResult, StatementRecord


def _require_flag() -> None:
    flag = os.getenv("BANK_STATEMENTS_REAL_ENABLED", "").lower()
    if flag not in {"1", "true", "yes"}:
        raise RuntimeError(
            "Real bank statements provider disabled. Set BANK_STATEMENTS_REAL_ENABLED=true to enable."
        )


class RealBankStatements:
    def __init__(self) -> None:
        self._base = os.getenv("BANK_STATEMENTS_API_BASE")
        if not self._base:
            raise RuntimeError("BANK_STATEMENTS_API_BASE is required for the real bank statements provider")
        ctx = ssl.create_default_context()
        ca_path = os.getenv("BANK_TLS_CA")
        if ca_path and os.path.exists(ca_path):
            ctx.load_verify_locations(cafile=ca_path)
        self._context = ctx

    async def ingest(self, csv_data: str | bytes) -> IngestResult:
        _require_flag()
        body = json.dumps({"csv": csv_data.decode() if isinstance(csv_data, (bytes, bytearray)) else csv_data}).encode()
        req = urllib.request.Request(
            f"{self._base}/statements/import",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, context=self._context, timeout=10) as resp:  # type: ignore[arg-type]
            data = json.loads(resp.read().decode() or "{}")
        return IngestResult(
            recordsIngested=int(data.get("ingested", 0)),
            discarded=int(data.get("discarded", 0)),
            batchId=str(data.get("batch_id", "unknown")),
            metadata=data.get("metadata"),
        )

    async def listUnreconciled(self) -> list[StatementRecord]:
        _require_flag()
        req = urllib.request.Request(f"{self._base}/statements/unreconciled")
        with urllib.request.urlopen(req, context=self._context, timeout=10) as resp:  # type: ignore[arg-type]
            data = json.loads(resp.read().decode() or "{}")
        items = data.get("items", [])
        return [StatementRecord(**item) for item in items]
