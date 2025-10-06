from __future__ import annotations
from typing import Literal, Dict, Any
import json
import os
from decimal import Decimal, ROUND_HALF_UP, ROUND_HALF_EVEN

GST_RATE = Decimal("0.10")
RULES_DIR = os.path.join(os.path.dirname(__file__), "rules")

_rounding_cache: Dict[str, str] = {}
_rules_cache: Dict[str, Dict[str, Any]] = {}


def _load_json(name: str) -> Dict[str, Any]:
    with open(os.path.join(RULES_DIR, name), "r", encoding="utf-8") as f:
        return json.load(f)


def _get_rounding(kind: str) -> str:
    if not _rounding_cache:
        data = _load_json("rounding.json")
        _rounding_cache.update(data)
    return _rounding_cache.get(kind, "HALF_UP")


def _load_rules(period: str) -> Dict[str, Any]:
    key = period.lower()
    if key not in _rules_cache:
        _rules_cache[key] = _load_json(f"paygw_{key}.json")
    return _rules_cache[key]


def _round(amount: Decimal, mode: str = "HALF_UP") -> int:
    if mode == "HALF_EVEN":
        quant = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)
    else:
        quant = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int((quant * 100).to_integral_value())


def _select_bracket(gross_cents: int, rules: Dict[str, Any]) -> Dict[str, Any]:
    for br in rules.get("brackets", []):
        if gross_cents <= int(br.get("up_to_cents", 0)):
            return br
    return rules.get("brackets", [{}])[-1]


def gst_line_tax(amount_cents: int, tax_code: Literal["GST","GST_FREE","EXEMPT","ZERO_RATED",""] = "GST") -> int:
    if amount_cents <= 0 or (tax_code or "").upper() != "GST":
        return 0
    rounding = _get_rounding("gst")
    amount = (Decimal(amount_cents) / Decimal(100)) * GST_RATE
    return _round(amount, rounding)


def paygw_withholding(period: str, gross_cents: int) -> int:
    if gross_cents <= 0:
        return 0
    rules = _load_rules(period)
    rounding = rules.get("rounding") or _get_rounding("withholding")
    br = _select_bracket(gross_cents, rules)
    gross_dollars = Decimal(gross_cents) / Decimal(100)
    withholding = Decimal(br.get("a", 0)) * gross_dollars - Decimal(br.get("b", 0)) + Decimal(br.get("fixed", 0))
    if withholding < 0:
        withholding = Decimal(0)
    return _round(withholding, rounding)


def paygw_weekly(gross_cents: int) -> int:
    return paygw_withholding("weekly", gross_cents)
