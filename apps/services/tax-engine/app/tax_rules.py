from __future__ import annotations

from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP
from typing import Literal, Optional

from .domains import payg_w as payg_w_mod
from .rules.loader import load_gst_rules, load_payg_rules_index, resolve_financial_year


def _gst_round(value: Decimal, rounding_mode: str) -> int:
    quant = Decimal("0.01")
    rounding = ROUND_HALF_UP if rounding_mode == "HALF_UP" else ROUND_HALF_EVEN
    cents = (value.quantize(quant, rounding=rounding) * Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(cents)


def gst_line_tax(
    amount_cents: int,
    tax_code: Literal["GST", "GST_INCLUSIVE", "GST_FREE", "EXEMPT", "ZERO_RATED", ""] = "GST",
    *,
    price_includes_gst: Optional[bool] = None,
) -> int:
    if amount_cents <= 0:
        return 0
    rules = load_gst_rules()
    codes = rules.get("codes", {})
    default = {"rate": 0.0, "mode": "exclusive"}
    config = codes.get((tax_code or "").upper(), default)
    rate = Decimal(str(config.get("rate", 0.0)))
    if rate <= 0:
        return 0
    amount = Decimal(amount_cents) / Decimal(100)
    mode = config.get("mode", "exclusive")
    if price_includes_gst is not None:
        mode = "inclusive" if price_includes_gst else "exclusive"
    if mode == "inclusive":
        taxable_base = amount / (Decimal(1) + rate)
        tax_value = amount - taxable_base
    else:
        tax_value = amount * rate
    return _gst_round(tax_value, rules.get("rounding", "HALF_UP"))


def paygw_weekly(
    gross_cents: int,
    *,
    financial_year: Optional[str] = None,
    payment_date: Optional[str] = None,
    tax_free_threshold: bool = True,
    stsl: bool = False,
    resident: bool = True,
) -> int:
    if gross_cents <= 0:
        return 0
    gross = gross_cents / 100.0
    rules_index = load_payg_rules_index()
    financial_year = resolve_financial_year(financial_year, payment_date)
    result = payg_w_mod.compute(
        {
            "payg_w": {
                "method": "table_ato",
                "period": "weekly",
                "gross": gross,
                "tax_free_threshold": tax_free_threshold,
                "stsl": stsl,
                "resident": resident,
                "financial_year": financial_year,
                "payment_date": payment_date,
            }
        },
        rules_index,
    )
    withholding_cents = int(round(result.get("withholding", 0.0) * 100))
    return max(0, withholding_cents)
