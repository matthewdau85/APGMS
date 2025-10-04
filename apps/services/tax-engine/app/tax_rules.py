from typing import Literal

GST_RATE = 0.10

def gst_line_tax(amount_cents: int, tax_code: Literal["GST","GST_FREE","EXEMPT","ZERO_RATED",""] = "GST") -> int:
    if amount_cents <= 0:
        return 0
    return round(amount_cents * GST_RATE) if (tax_code or "").upper() == "GST" else 0

def paygw_weekly(gross_cents: int) -> int:
    """
    Progressive toy scale used by tests:
      - 15% up to 80,000?
      - 20% on the portion above 80,000?
    """
    if gross_cents <= 0:
        return 0
    bracket = 80_000
    if gross_cents <= bracket:
        return round(gross_cents * 0.15)
    base = round(bracket * 0.15)
    excess = gross_cents - bracket
    return base + round(excess * 0.20)
