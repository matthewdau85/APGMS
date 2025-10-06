from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Iterable, Literal, Mapping

from .rounding import round_currency

GST_RATE = Decimal("0.10")
HUNDRED = Decimal(100)


def _decimal_from_cents(amount_cents: int) -> Decimal:
    return Decimal(int(amount_cents)) / HUNDRED


def _decimal_to_cents(amount: Decimal) -> int:
    return int((amount * HUNDRED).to_integral_value(rounding=ROUND_HALF_UP))


def gst_line_tax(amount_cents: int, tax_code: Literal["GST", "GST_FREE", "EXEMPT", "ZERO_RATED", ""] = "GST") -> int:
    """Calculate GST for a single line item using the configured rounding order."""

    if amount_cents <= 0:
        return 0
    if (tax_code or "").upper() != "GST":
        return 0

    # Rounding order is configured in rules/rounding.yaml (line then aggregate).
    taxable_amount = _decimal_from_cents(amount_cents)
    line_tax = taxable_amount * GST_RATE
    rounded = round_currency(line_tax, method="gst", stage="line")
    return _decimal_to_cents(rounded)


def gst_label_totals(lines: Iterable[Mapping[str, int | str]]) -> Dict[str, Dict[str, int]]:
    """Aggregate GST line results into BAS labels respecting the documented rounding order.

    Each line should provide ``amount_cents`` (GST-exclusive) and optionally a
    ``tax_code`` (defaults to ``GST``) and ``label`` (defaults to ``1A`` for GST).
    The result contains the accumulated cents (line-level rounding) and the final
    whole-dollar amount submitted on the BAS label.
    """

    totals: Dict[str, Dict[str, int]] = {}
    for line in lines:
        amount_cents = int(line.get("amount_cents", 0))
        tax_code = str(line.get("tax_code", "GST") or "GST")
        label = line.get("label")
        if (tax_code or "").upper() != "GST":
            continue
        label = label or "1A"
        tax_cents = gst_line_tax(amount_cents, tax_code)
        if tax_cents == 0:
            continue
        bucket = totals.setdefault(label, {"cents": 0, "label": 0})
        bucket["cents"] += tax_cents

    for label, bucket in totals.items():
        cents = bucket["cents"]
        dollars = round_currency(_decimal_from_cents(cents), method="gst", stage="aggregate")
        bucket["label"] = int(dollars.to_integral_value(rounding=ROUND_HALF_UP))

    return totals


_PERIOD_PARAMS: Dict[str, Dict[str, Decimal]] = {
    "weekly": {"bracket": Decimal("800.00"), "base_rate": Decimal("0.15"), "excess_rate": Decimal("0.20")},
    "monthly": {"bracket": Decimal("3466.67"), "base_rate": Decimal("0.15"), "excess_rate": Decimal("0.20")},
}


def paygw_table_withholding(gross_cents: int, period: str = "weekly") -> int:
    """Toy progressive schedule with configurable rounding per pay period."""

    if gross_cents <= 0:
        return 0

    params = _PERIOD_PARAMS.get(period, _PERIOD_PARAMS["weekly"])
    gross = _decimal_from_cents(gross_cents)
    bracket = params["bracket"]
    base_rate = params["base_rate"]
    excess_rate = params["excess_rate"]

    if gross <= bracket:
        withholding = gross * base_rate
    else:
        base = bracket * base_rate
        excess = gross - bracket
        withholding = base + excess * excess_rate

    rounded = round_currency(withholding, method="paygw_table", stage="line", period=period)
    return _decimal_to_cents(rounded)


def paygw_label_totals(withholding_cents: Iterable[int], period: str = "weekly") -> Dict[str, int]:
    """Aggregate PAYGW withholding amounts and round to BAS whole dollars."""

    total_cents = sum(int(v) for v in withholding_cents)
    dollars = round_currency(_decimal_from_cents(total_cents), method="paygw_table", stage="aggregate", period=period)
    return {
        "cents": total_cents,
        "label": int(dollars.to_integral_value(rounding=ROUND_HALF_UP)),
    }


def paygw_weekly(gross_cents: int) -> int:
    """Compatibility wrapper used by legacy tests."""

    return paygw_table_withholding(gross_cents, period="weekly")
