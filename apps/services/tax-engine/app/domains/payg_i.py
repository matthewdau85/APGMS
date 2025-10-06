from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, Mapping

from .utils import round_cents, to_decimal


def compute(event: Dict[str, Any], rules: Mapping[str, Any]) -> Dict[str, Any]:
    paygi = event.get("payg_i") or {}
    method = (paygi.get("method") or "instalment_rate").lower()
    gdp_uplift = to_decimal(rules.get("gdp_uplift", 0))

    labels: Dict[str, Any] = {}
    variation_info: Dict[str, Any] | None = None

    if method == "instalment_rate":
        instalment_income = round_cents(paygi.get("instalment_income", 0))
        base_rate = to_decimal(paygi.get("instalment_rate", 0))
        effective_rate = base_rate * (Decimal("1") + gdp_uplift)
        instalment_amount = round_cents(instalment_income * effective_rate / Decimal("100"))

        labels["T1"] = float(instalment_income)
        labels["T2"] = float(round_cents(effective_rate))
        labels["T3"] = float(instalment_amount)
    else:  # pragma: no cover - reserved for future methods
        raise ValueError(f"Unsupported PAYGI method '{method}'")

    variation = paygi.get("variation")
    if variation:
        variation_amount = round_cents(variation.get("estimate", 0))
        labels["T4"] = float(variation_amount)
        variation_info = {
            "reason": variation.get("reason", "unspecified"),
            "safe_harbour": bool(variation.get("safe_harbour", False)),
        }
    else:
        labels.setdefault("T4", 0.0)

    return {
        "labels": labels,
        "variation": variation_info,
        "method": method,
        "gdp_uplift_applied": float(round_cents(gdp_uplift * Decimal("100"))),
    }
