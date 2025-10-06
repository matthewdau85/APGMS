"""Heuristic anomaly scorer used to triage reconciliation breaks."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List


@dataclass
class ReconItem:
    item_id: str
    recon_delta: float
    late_settlement_minutes: int
    duplicate_crn: bool


def score_item(item: ReconItem) -> Dict[str, object]:
    """Return a risk score and factor contributions for an item."""
    # Gradient boosted classifier stand-in using deterministic weights.
    contributions = {
        "recon_delta": min(abs(item.recon_delta) / 1000.0, 1.0) * 0.55,
        "late_settlement": min(item.late_settlement_minutes / 1440.0, 1.0) * 0.25,
        "duplicate_crn": 0.2 if item.duplicate_crn else 0.0,
    }
    risk_score = min(0.05 + sum(contributions.values()), 0.99)
    sorted_factors: List[Dict[str, float]] = [
        {"feature": feature, "impact": round(weight, 3)}
        for feature, weight in sorted(contributions.items(), key=lambda kv: kv[1], reverse=True)
        if weight > 0
    ]
    explainability = {
        "recon_delta_abs": abs(item.recon_delta),
        "late_settlement_minutes": item.late_settlement_minutes,
        "duplicate_crn": item.duplicate_crn,
    }
    return {
        "item_id": item.item_id,
        "risk_score": round(risk_score, 3),
        "top_factors": sorted_factors,
        "explainability": explainability,
    }
