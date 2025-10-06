"""Mock bank statements provider for Python services."""
from __future__ import annotations

import csv
import io
import uuid
from typing import List

from libs.core.ports import IngestResult, StatementRecord


class MockBankStatements:
    def __init__(self) -> None:
        self._store: List[StatementRecord] = []

    async def ingest(self, csv_data: str | bytes) -> IngestResult:
        text = csv_data.decode() if isinstance(csv_data, (bytes, bytearray)) else str(csv_data)
        reader = csv.reader(io.StringIO(text))
        ingested = 0
        for row in reader:
            if len(row) < 2:
                continue
            statement_id, amount = row[0].strip(), row[1].strip()
            if not statement_id:
                continue
            try:
                amount_cents = int(float(amount))
            except ValueError:
                continue
            reference = row[2].strip() if len(row) > 2 else ""
            self._store.append(
                StatementRecord(statementId=statement_id, amount_cents=amount_cents, reference=reference)
            )
            ingested += 1
        return IngestResult(recordsIngested=ingested, discarded=0, batchId=str(uuid.uuid4()))

    async def listUnreconciled(self) -> list[StatementRecord]:
        return list(self._store)
