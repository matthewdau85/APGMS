import json
import os
from functools import lru_cache
from typing import Literal

from .domains import payg_w as payg_w_mod

GST_RATE = 0.10
GIC_ANNUAL_RATE = 0.1039  # ATO published general interest charge for 2024-25 (10.39%)

@lru_cache()
def _load_payg_rules():
    rules_path = os.path.join(os.path.dirname(__file__), "rules", "payg_w_2024_25.json")
    with open(rules_path, "r", encoding="utf-8") as handle:
        return json.load(handle)

def gst_line_tax(amount_cents: int, tax_code: Literal["GST", "GST_FREE", "EXEMPT", "ZERO_RATED", ""] = "GST") -> int:
    if amount_cents <= 0 or (tax_code or "").upper() != "GST":
        return 0
    return round(amount_cents * GST_RATE)

def paygw_weekly(gross_cents: int, *, tax_free_threshold: bool = True, stsl: bool = False) -> int:
    if gross_cents <= 0:
        return 0
    rules = _load_payg_rules()
    gross_dollars = gross_cents / 100.0
    event = {
        "payg_w": {
            "method": "table_ato",
            "period": "weekly",
            "gross": gross_dollars,
            "tax_free_threshold": tax_free_threshold,
            "stsl": stsl,
        }
    }
    result = payg_w_mod.compute(event, rules)
    return int(round(result["withholding"] * 100))

def penalty_general_interest(amount: float, days_late: int, *, annual_rate: float = GIC_ANNUAL_RATE) -> float:
    if amount <= 0 or days_late <= 0:
        return 0.0
    daily_rate = annual_rate / 365.0
    accumulated = amount * ((1 + daily_rate) ** days_late - 1)
    return round(accumulated, 2)
