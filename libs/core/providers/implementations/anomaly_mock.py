"""Mock anomaly scoring provider."""
from __future__ import annotations

from libs.core.ports import AnomalyScore


class MockAnomaly:
    def __init__(self) -> None:
        self._threshold = 0.8

    async def score(self, payload: dict) -> AnomalyScore:
        amount = abs(float(payload.get("amount_cents", 0)))
        score = min(1.0, amount / 1_000_000)
        decision = "review" if score > self._threshold else "allow"
        return AnomalyScore(decision=decision, score=score, metadata={"threshold": self._threshold})
