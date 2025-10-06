from __future__ import annotations

from decimal import Decimal
from typing import Dict, Iterable, Literal, Optional

from .engine import RULES, compute_gst as _compute_gst, compute_withholding as _compute_withholding, ledger


def compute_withholding(
    amount: float | Decimal,
    period: str,
    residency: str,
    opts: Optional[Dict[str, object]] = None,
) -> int:
    return _compute_withholding(amount, period, residency, opts)


def compute_gst(
    period_id: str,
    basis: str,
    transactions: Optional[Iterable[Dict[str, object]]] = None,
) -> Dict[str, Dict[str, int] | int]:
    return _compute_gst(period_id, basis, transactions)


def gst_line_tax(
    amount_cents: int,
    tax_code: Literal["GST", "GST_FREE", "EXEMPT", "ZERO_RATED", "INPUT_TAXED", ""] = "GST",
    basis: str = "cash",
) -> int:
    """Compatibility helper used by legacy tooling to calculate GST for a single line."""
    result = _compute_gst(
        "adhoc",
        basis,
        [
            {
                "type": "sale",
                "total_cents": int(amount_cents),
                "tax_code": tax_code,
                "recognised": [basis],
            }
        ],
    )
    return int(result.get("1A", 0))


def paygw_weekly(gross_cents: int) -> int:
    return _compute_withholding(Decimal(gross_cents) / 100, "weekly", "resident", {"tax_free_threshold": True})


__all__ = [
    "RULES",
    "ledger",
    "compute_withholding",
    "compute_gst",
    "gst_line_tax",
    "paygw_weekly",
]
