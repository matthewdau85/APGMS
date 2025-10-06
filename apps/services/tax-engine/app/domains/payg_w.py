from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict

from ..engines.paygw import compute_withholding


def _to_cents(amount: Any) -> int:
    try:
        dec = Decimal(str(amount or 0))
    except Exception:
        dec = Decimal(0)
    return int((dec * 100).to_integral_value())


def compute(event: Dict[str, Any]) -> Dict[str, Any]:
    payload = event.get("payg_w", {}) or {}
    period = str(payload.get("period") or "weekly")
    gross_cents = _to_cents(payload.get("gross"))
    flags = {
        "tax_free_threshold": bool(payload.get("tax_free_threshold", True))
    }
    if payload.get("no_tfn"):
        flags["no_tfn"] = True

    cents = compute_withholding({
        "gross": gross_cents,
        "period": period,
        "scale": payload.get("scale", "resident"),
        "flags": flags
    })
    net_cents = gross_cents - cents
    return {
        "period": period,
        "gross_cents": gross_cents,
        "withholding_cents": cents,
        "net_cents": net_cents,
        "flags": flags
    }
