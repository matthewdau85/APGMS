from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP, getcontext
from typing import Literal

from .rates import RatesVersion

getcontext().prec = 28


def gst_line_tax(
    amount_cents: int,
    rates: RatesVersion,
    tax_code: Literal["GST", "GST_FREE", "EXEMPT", "ZERO_RATED", ""] = "GST",
) -> int:
    """Calculate GST for a line item using the supplied rates version."""

    if amount_cents <= 0:
        return 0
    if (tax_code or "").upper() != "GST":
        return 0
    tax = (Decimal(amount_cents) * rates.gst_rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(tax)


def paygw_weekly(gross_cents: int, rates: RatesVersion) -> int:
    """Toy progressive PAYG-W calculator driven by the injected rates version."""

    if gross_cents <= 0:
        return 0

    gross = Decimal(gross_cents)
    total = Decimal("0")
    previous_limit = Decimal("0")

    for bracket in rates.paygw_brackets:
        limit = Decimal(bracket.threshold_cents) if bracket.threshold_cents is not None else None
        rate = bracket.rate

        if limit is None or gross <= limit:
            taxable = gross - previous_limit
            if taxable > 0:
                total += taxable * rate
            break

        taxable = limit - previous_limit
        if taxable > 0:
            total += taxable * rate
        previous_limit = limit

    return int(total.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
