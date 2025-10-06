from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

RULES_DIR = Path(__file__).resolve().parents[1] / "rules"
RITC_FILE_TEMPLATE = "gst_ritc_{year}.json"
DEFAULT_YEAR = 2025


def _to_decimal(value) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def load_ritc_rules(year: int = DEFAULT_YEAR, path: Path | None = None) -> Dict:
    rules_path = path or RULES_DIR / RITC_FILE_TEMPLATE.format(year=year)
    with open(rules_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def apply_ritc(
    bas_summary: Dict[str, Decimal],
    purchases: Iterable[Dict],
    *,
    rules: Optional[Dict] = None,
) -> Tuple[Dict[str, Decimal], List[Dict]]:
    rules = rules or load_ritc_rules()
    categories = rules.get("categories", {})
    evidence: List[Dict] = []
    bas_summary.setdefault("1B", Decimal("0.00"))

    for item in purchases:
        category = (item.get("category") or "").lower()
        schedule = categories.get(category)
        if not schedule:
            raise ValueError(f"Unsupported RITC category: {category}")
        percentage = Decimal(str(schedule.get("percentage", 0)))
        gst_amount = _to_decimal(item.get("gst_amount"))
        allowed = (gst_amount * percentage).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        reduction = (gst_amount - allowed).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if reduction:
            bas_summary["1B"] -= reduction
        evidence.append(
            {
                "category": category,
                "gst_amount": gst_amount,
                "percentage": float(percentage),
                "reduction": reduction,
                "rule_hash": schedule.get("rule_hash") or rules.get("rule_hash"),
            }
        )
    return bas_summary, evidence
