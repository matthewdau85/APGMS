from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

RULES_DIR = Path(__file__).resolve().parents[1] / "rules"
WET_FILE_TEMPLATE = "wet_{year}.json"
LCT_FILE_TEMPLATE = "lct_{year}.json"
DEFAULT_YEAR = 2025


def _to_decimal(value) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def load_wet_rules(year: int = DEFAULT_YEAR, path: Path | None = None) -> Dict:
    rules_path = path or RULES_DIR / WET_FILE_TEMPLATE.format(year=year)
    with open(rules_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_lct_rules(year: int = DEFAULT_YEAR, path: Path | None = None) -> Dict:
    rules_path = path or RULES_DIR / LCT_FILE_TEMPLATE.format(year=year)
    with open(rules_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def apply_wet_lct(
    bas_summary: Dict[str, Decimal],
    wet_items: Optional[Iterable[Dict]] = None,
    lct_items: Optional[Iterable[Dict]] = None,
    *,
    wet_rules: Optional[Dict] = None,
    lct_rules: Optional[Dict] = None,
) -> Tuple[Dict[str, Decimal], List[Dict]]:
    wet_rules = wet_rules or load_wet_rules()
    lct_rules = lct_rules or load_lct_rules()

    evidence: List[Dict] = []

    wet_label = wet_rules.get("bas_label", "1C")
    lct_label = lct_rules.get("bas_label", "1E")
    bas_summary.setdefault(wet_label, Decimal("0.00"))
    bas_summary.setdefault(lct_label, Decimal("0.00"))

    if wet_items:
        rate = Decimal(str(wet_rules.get("rate", 0)))
        rebate_cap = _to_decimal(wet_rules.get("rebate_cap")) if wet_rules.get("rebate_cap") else None
        for item in wet_items:
            taxable_value = _to_decimal(item.get("wholesale_value"))
            wet_amount = (taxable_value * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if rebate_cap and wet_amount > rebate_cap:
                wet_amount = rebate_cap
            bas_summary[wet_label] += wet_amount
            evidence.append(
                {
                    "type": "wet",
                    "reference": item.get("reference"),
                    "amount": wet_amount,
                    "rule_hash": wet_rules.get("rule_hash"),
                }
            )

    if lct_items:
        thresholds = lct_rules.get("thresholds", {})
        default_threshold = thresholds.get("other", {})
        for item in lct_items:
            fuel_flag = item.get("fuel_efficient")
            if fuel_flag is None:
                if "fuel_efficiency_test_l_per_100km" in item:
                    fuel_flag = item["fuel_efficiency_test_l_per_100km"] <= thresholds.get("fuel_efficient", {}).get("fuel_efficiency_test_l_per_100km", 0)
            schedule = thresholds.get("fuel_efficient" if fuel_flag else "other", default_threshold)
            threshold_value = Decimal(str(schedule.get("threshold", default_threshold.get("threshold", 0))))
            rate = Decimal(str(schedule.get("rate", default_threshold.get("rate", 0))))
            taxable_value = _to_decimal(item.get("luxury_value"))
            if taxable_value <= threshold_value:
                continue
            lct_amount = ((taxable_value - threshold_value) * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            bas_summary[lct_label] += lct_amount
            evidence.append(
                {
                    "type": "lct",
                    "reference": item.get("reference"),
                    "amount": lct_amount,
                    "rule_hash": schedule.get("rule_hash") or lct_rules.get("rule_hash"),
                }
            )

    return bas_summary, evidence
