import json
import os
from typing import Literal

from .domains import payg_w

_RULES_PATH = os.path.join(os.path.dirname(__file__), "rules", "payg_w_2024_25.json")
with open(_RULES_PATH, "r", encoding="utf-8") as _f:
    _RULES = json.load(_f)

_GST_RULES = _RULES.get("gst", {}) or {}


def gst_line_tax(
    amount_cents: int,
    tax_code: Literal["GST", "GST_FREE", "EXEMPT", "ZERO_RATED", "INPUT_TAXED", "CAPITAL", "IMPORT", "NONE", ""] = "GST",
    *,
    kind: Literal["sale", "purchase"] = "sale",
) -> int:
    if amount_cents <= 0:
        return 0
    code = (tax_code or "").upper()
    if kind == "purchase":
        rate = float((_GST_RULES.get("purchase_offsets", {}) or {}).get(code, 0.0))
        return int(round(-amount_cents * rate))
    base_rate = float(_GST_RULES.get("rate", 0.0))
    if code in ("GST", "CAPITAL", "IMPORT"):
        rate = base_rate
    else:
        rate = 0.0
    return int(round(amount_cents * rate))

def paygw_weekly(
    gross_cents: int,
    *,
    tax_free_threshold: bool = True,
    stsl: bool = False,
) -> int:
    if gross_cents <= 0:
        return 0
    gross = gross_cents / 100.0
    event = {
        "payg_w": {
            "method": "table_ato",
            "period": "weekly",
            "gross": gross,
            "tax_free_threshold": tax_free_threshold,
            "stsl": stsl,
        }
    }
    result = payg_w.compute(event, _RULES)
    return int(round(result["withholding"] * 100))
