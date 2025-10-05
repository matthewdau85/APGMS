"""Mock rates provider."""
from __future__ import annotations

from datetime import datetime
from typing import List

from libs.core.ports import RatesVersion


class MockRates:
    def __init__(self) -> None:
        self._versions: List[RatesVersion] = [
            RatesVersion(effectiveDate="2024-07-01", updatedAt="2024-07-01T00:00:00Z", rates={"gst": 0.1}),
        ]

    async def currentFor(self, date: str | datetime) -> RatesVersion:
        target = datetime.fromisoformat(date if isinstance(date, str) else date.isoformat())
        versions = sorted(self._versions, key=lambda v: v["effectiveDate"], reverse=True)
        for version in versions:
            if datetime.fromisoformat(version["effectiveDate"]) <= target:
                return version
        return versions[-1]

    async def listVersions(self) -> list[RatesVersion]:
        return list(self._versions)
