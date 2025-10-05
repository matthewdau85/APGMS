from pathlib import Path
from typing import Dict, Literal
import json

from .domains import payg_w

GST_RATES: Dict[str, float] = {
    "GST": 0.10,
    "GST_FREE": 0.0,
    "INPUT_TAXED": 0.0,
    "EXPORT": 0.0,
}

_RULES_PATH = Path(__file__).resolve().parent / "rules" / "payg_w_2024_25.json"
with _RULES_PATH.open("r", encoding="utf-8") as _fh:
    PAYG_RULES = json.load(_fh)

def gst_line_tax(amount_cents: int, tax_code: Literal["GST","GST_FREE","EXEMPT","ZERO_RATED","INPUT_TAXED","EXPORT",""] = "GST") -> int:
    if amount_cents <= 0:
        return 0
    code = (tax_code or "GST").upper()
    rate = GST_RATES.get(code, 0.0)
    return round(amount_cents * rate)

def paygw_withholding(gross_cents: int, period: Literal["weekly","fortnightly","monthly","quarterly"] = "weekly", *, tax_free_threshold: bool = True, stsl: bool = False) -> int:
    if gross_cents <= 0:
        return 0
    event = {
        "payg_w": {
            "method": "table_ato",
            "period": period,
            "gross": gross_cents / 100.0,
            "tax_free_threshold": tax_free_threshold,
            "stsl": stsl,
        }
    }
    result = payg_w.compute(event, PAYG_RULES)
    return int(round(result["withholding"] * 100))

def paygw_weekly(gross_cents: int) -> int:
    return paygw_withholding(gross_cents, period="weekly")
