"""Real rates provider using HTTP."""
from __future__ import annotations

import json
import os
import urllib.request

from libs.core.ports import RatesVersion


def _require_flag() -> None:
    flag = os.getenv("RATES_REAL_ENABLED", "").lower()
    if flag not in {"1", "true", "yes"}:
        raise RuntimeError("Real rates provider disabled. Set RATES_REAL_ENABLED=true to enable.")


def _base() -> str:
    base = os.getenv("RATES_API_BASE")
    if not base:
        raise RuntimeError("RATES_API_BASE must be configured for the real rates provider")
    return base


class RealRates:
    async def currentFor(self, date: str) -> RatesVersion:
        _require_flag()
        req = urllib.request.Request(f"{_base()}/rates/current?date={date}")
        with urllib.request.urlopen(req, timeout=5) as resp:  # type: ignore[arg-type]
            return json.loads(resp.read().decode() or "{}")

    async def listVersions(self) -> list[RatesVersion]:
        _require_flag()
        req = urllib.request.Request(f"{_base()}/rates/versions")
        with urllib.request.urlopen(req, timeout=5) as resp:  # type: ignore[arg-type]
            data = json.loads(resp.read().decode() or "[]")
        return data
