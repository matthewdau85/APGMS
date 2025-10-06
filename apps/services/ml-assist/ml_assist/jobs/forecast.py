"""Univariate liability forecasting helpers."""

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean, pstdev
from typing import Dict, Iterable, List


@dataclass
class LiabilityObservation:
    period: str
    liability: float


def forecast(period: str, history: Iterable[LiabilityObservation]) -> Dict[str, object]:
    observations: List[LiabilityObservation] = list(history)
    if not observations:
        raise ValueError("history is required for forecasting")
    tail = observations[-3:]
    point_estimate = mean([obs.liability for obs in tail])
    variation = pstdev([obs.liability for obs in tail]) if len(tail) > 1 else 0.0
    interval_padding = max(variation * 1.96, point_estimate * 0.1)
    lower = max(point_estimate - interval_padding, 0.0)
    upper = point_estimate + interval_padding
    explainability = {
        "history_periods": [obs.period for obs in tail],
        "history_mean": round(point_estimate, 2),
        "history_variation": round(variation, 2),
    }
    return {
        "period": period,
        "point": round(point_estimate, 2),
        "interval": [round(lower, 2), round(upper, 2)],
        "explainability": explainability,
    }
