from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Dict, Literal, Sequence


CENT = Decimal("0.01")
HUNDRED = Decimal(100)

GST_RATE = Decimal("0.10")
SG_RATE_2024_25 = Decimal("0.115")
SG_QUARTERLY_MAX_BASE_CENTS = 62_270 * 100
FBT_RATE = Decimal("0.47")
FBT_GROSS_UP_FACTORS: Dict[str, Decimal] = {
    "type1": Decimal("2.0802"),
    "type2": Decimal("1.8868"),
}
PAYROLL_TAX_DEFAULTS: Dict[str, Dict[str, Decimal | int]] = {
    "NSW": {
        "threshold_cents": 1_200_000 * 100,
        "rate": Decimal("0.0545"),
    }
}

RULES_DIR = Path(__file__).resolve().parent / "rules"


def _decimal_to_cents(amount: Decimal) -> int:
    quantized = amount.quantize(CENT, rounding=ROUND_HALF_UP)
    return int((quantized * HUNDRED).to_integral_value(rounding=ROUND_HALF_UP))


def _cents_to_decimal(cents: int) -> Decimal:
    return (Decimal(int(cents)) / HUNDRED).quantize(CENT)


def gst_line_tax(
    amount_cents: int,
    tax_code: Literal["GST", "GST_FREE", "EXEMPT", "ZERO_RATED", ""] = "GST",
) -> int:
    if amount_cents <= 0:
        return 0
    if (tax_code or "").upper() != "GST":
        return 0
    taxable_dollars = _cents_to_decimal(amount_cents)
    tax = taxable_dollars * GST_RATE
    return _decimal_to_cents(tax)


def gst_invoice_totals(lines: Sequence[Dict[str, int | str]]) -> Dict[str, int]:
    net_cents = 0
    tax_cents = 0
    for line in lines:
        amount = int(line.get("amount_cents", 0))
        tax_code = str(line.get("tax_code", "GST"))
        net_cents += amount
        tax_cents += gst_line_tax(amount, tax_code)
    gross_cents = net_cents + tax_cents
    return {
        "net_cents": net_cents,
        "tax_cents": tax_cents,
        "gross_cents": gross_cents,
    }


def paygw_weekly(gross_cents: int) -> int:
    """Toy PAYGW example retained for legacy unit tests."""
    if gross_cents <= 0:
        return 0
    bracket = 80_000
    if gross_cents <= bracket:
        return round(gross_cents * 0.15)
    base = round(bracket * 0.15)
    excess = gross_cents - bracket
    return base + round(excess * 0.20)


def paygi_instalment(
    instalment_income_cents: int,
    rate: float,
    *,
    credits_cents: int = 0,
    adjustments_cents: int = 0,
) -> int:
    income = _cents_to_decimal(instalment_income_cents)
    credits = _cents_to_decimal(credits_cents)
    adjustments = _cents_to_decimal(adjustments_cents)
    base = income * Decimal(str(rate))
    liability = base - credits + adjustments
    if liability <= 0:
        return 0
    return _decimal_to_cents(liability)


def sg_quarterly_obligation(
    ordinary_time_earnings_cents: int,
    *,
    rate: float | Decimal = SG_RATE_2024_25,
    quarterly_cap_cents: int = SG_QUARTERLY_MAX_BASE_CENTS,
) -> int:
    capped_earnings = min(int(ordinary_time_earnings_cents), int(quarterly_cap_cents))
    base = _cents_to_decimal(capped_earnings)
    contribution = base * Decimal(str(rate))
    if contribution <= 0:
        return 0
    return _decimal_to_cents(contribution)


def fbt_liability(
    taxable_value_cents: int,
    *,
    benefits_type: str = "type1",
    rate: float | Decimal = FBT_RATE,
) -> int:
    gross_up = FBT_GROSS_UP_FACTORS.get(benefits_type.lower()) or FBT_GROSS_UP_FACTORS.get(benefits_type.upper())
    if gross_up is None:
        raise ValueError(f"Unknown FBT benefits_type '{benefits_type}'")
    taxable_value = _cents_to_decimal(taxable_value_cents)
    grossed_up = taxable_value * gross_up
    liability = grossed_up * Decimal(str(rate))
    if liability <= 0:
        return 0
    return _decimal_to_cents(liability)


def payroll_tax_liability(
    annual_wages_cents: int,
    *,
    state: str = "NSW",
    threshold_cents: int | None = None,
    rate: float | Decimal | None = None,
) -> int:
    defaults = PAYROLL_TAX_DEFAULTS.get(state.upper(), PAYROLL_TAX_DEFAULTS["NSW"])
    threshold = int(threshold_cents if threshold_cents is not None else defaults["threshold_cents"])
    effective_rate = Decimal(str(rate)) if rate is not None else Decimal(str(defaults["rate"]))
    excess = max(0, int(annual_wages_cents) - threshold)
    if excess <= 0:
        return 0
    liability = _cents_to_decimal(excess) * effective_rate
    return _decimal_to_cents(liability)


def rules_path(filename: str) -> Path:
    return RULES_DIR / filename
