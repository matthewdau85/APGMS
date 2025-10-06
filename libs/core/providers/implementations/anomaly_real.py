"""Real anomaly scoring provider wrapper."""
from __future__ import annotations

import json
import os
import urllib.request

from libs.core.ports import AnomalyScore


def _require_flag() -> None:
    flag = os.getenv("ANOMALY_REAL_ENABLED", "").lower()
    if flag not in {"1", "true", "yes"}:
        raise RuntimeError("Real anomaly provider disabled. Set ANOMALY_REAL_ENABLED=true to enable.")


def _base() -> str:
    base = os.getenv("ANOMALY_API_BASE")
    if not base:
        raise RuntimeError("ANOMALY_API_BASE must be configured for the real anomaly provider")
    return base


class RealAnomaly:
    async def score(self, payload: dict) -> AnomalyScore:
        _require_flag()
        req = urllib.request.Request(
            f"{_base()}/score",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:  # type: ignore[arg-type]
            data = json.loads(resp.read().decode() or "{}")
        return AnomalyScore(**data)
