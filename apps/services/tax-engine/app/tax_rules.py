from __future__ import annotations

from typing import Literal

from .engine import paygw_calc

GST_RATE = 0.10


def gst_line_tax(amount_cents: int, tax_code: Literal["GST","GST_FREE","EXEMPT","ZERO_RATED",""] = "GST") -> int:
    if amount_cents <= 0:
        return 0
    return round(amount_cents * GST_RATE) if (tax_code or "").upper() == "GST" else 0


def calculate_paygw(pay_event: dict, *, year: str = "2024_25") -> dict:
    """Proxy helper that delegates to the PAYG calculator."""
    return paygw_calc.calculate(pay_event, year=year)


def paygw_weekly(gross_cents: int) -> int:
    """Compatibility helper used by legacy tests."""
    dollars = gross_cents / 100
    result = calculate_paygw(
        {
            "period": "weekly",
            "gross": dollars,
            "residency": "resident",
            "tax_free_threshold": True,
        }
    )
    return int(round(result["total_withholding"] * 100))
