from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from decimal import Decimal, ROUND_HALF_UP

from .rates_repository import RatesRepository

__all__ = ["gst_line_tax", "paygw_weekly"]

_REPO = RatesRepository()


def _fallback_gst(amount_cents: int) -> int:
    if amount_cents <= 0:
        return 0
    result = (Decimal(amount_cents) * Decimal("0.10")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(result)


def gst_line_tax(
    amount_cents: int,
    tax_code: Literal["GST", "GST_FREE", "EXEMPT", "ZERO_RATED", ""] = "GST",
    *,
    as_of: Optional[date] = None,
) -> int:
    """Return GST component for a line item based on the active rate version."""
    if amount_cents <= 0:
        return 0
    if (tax_code or "").upper() != "GST":
        return 0
    try:
        version = _REPO.get_active_version("GST", period="per_line", as_of=as_of)
        scale = _REPO.select_scale(version, code="STANDARD")
        return _REPO.compute_flat_rate_cents(amount_cents, version, scale)
    except LookupError:
        return _fallback_gst(amount_cents)


def _fallback_paygw(gross_cents: int) -> int:
    if gross_cents <= 0:
        return 0
    bracket = 80_000
    if gross_cents <= bracket:
        return round(gross_cents * 0.15)
    base = round(bracket * 0.15)
    excess = gross_cents - bracket
    return base + round(excess * 0.20)


def paygw_weekly(
    gross_cents: int,
    *,
    tax_free_threshold: bool = True,
    stsl: bool = False,
    as_of: Optional[date] = None,
) -> int:
    """Compute weekly PAYGW withholding using the active rates_version data.

    Examples
    --------
    >>> paygw_weekly(35900)
    0
    >>> paygw_weekly(43800)
    1522
    >>> paygw_weekly(72100)
    10169
    """
    if gross_cents <= 0:
        return 0
    try:
        version = _REPO.get_active_version("PAYGW", period="weekly", as_of=as_of)
        scale = _REPO.select_scale(
            version,
            tax_free_threshold=tax_free_threshold,
            stsl=stsl,
        )
        return _REPO.compute_progressive_cents(gross_cents, version, scale)
    except LookupError:
        return _fallback_paygw(gross_cents)
