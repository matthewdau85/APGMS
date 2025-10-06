from typing import Literal

from .money import MoneyCents, from_cents, mul_bp, to_cents

GST_BP = 1000  # 10%
PAYGW_BASE_BP = 1500
PAYGW_TOP_BP = 2000


def gst_line_tax(amount_cents: MoneyCents, tax_code: Literal["GST", "GST_FREE", "EXEMPT", "ZERO_RATED", ""] = "GST") -> MoneyCents:
    cents = to_cents(amount_cents)
    if cents <= 0:
        return from_cents(0)
    return mul_bp(from_cents(cents), GST_BP) if (tax_code or "").upper() == "GST" else from_cents(0)


def paygw_weekly(gross_cents: MoneyCents) -> MoneyCents:
    """
    Progressive toy scale used by tests:
      - 15% up to 80,000?
      - 20% on the portion above 80,000?
    """
    cents = to_cents(gross_cents)
    if cents <= 0:
        return from_cents(0)
    bracket = 80_000
    if cents <= bracket:
        return mul_bp(from_cents(cents), PAYGW_BASE_BP)
    base = mul_bp(from_cents(bracket), PAYGW_BASE_BP)
    excess = cents - bracket
    bonus = mul_bp(from_cents(excess), PAYGW_TOP_BP)
    return from_cents(to_cents(base) + to_cents(bonus))
