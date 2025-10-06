from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

RULES_DIR = Path(__file__).resolve().parents[1] / "rules"
ADJUSTMENTS_FILE = RULES_DIR / "gst_adjustments.json"


def _to_decimal(value) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def load_adjustment_rules(path: Path | None = None) -> Dict:
    rules_path = path or ADJUSTMENTS_FILE
    with open(rules_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def apply_adjustments(
    bas_summary: Dict[str, Decimal],
    adjustments: Iterable[Dict],
    *,
    rules: Optional[Dict] = None,
) -> Tuple[Dict[str, Decimal], List[Dict]]:
    rules = rules or load_adjustment_rules()
    triggers = rules.get("triggers", {})
    evidence: List[Dict] = []

    for adj in adjustments:
        trigger = adj.get("trigger")
        direction = (adj.get("direction") or "").lower()
        applies_to = (adj.get("applies_to") or "sales").lower()
        bucket = triggers.get(trigger)
        if not bucket:
            raise ValueError(f"Unsupported adjustment trigger: {trigger}")
        detail = bucket.get(applies_to)
        if not detail:
            raise ValueError(f"Unsupported adjustment scope '{applies_to}' for trigger '{trigger}'")
        labels = detail.get("labels", {})
        amount_label = labels.get("amount")
        gst_label = labels.get("gst")
        if not amount_label or not gst_label:
            raise ValueError(f"Missing BAS labels for trigger '{trigger}' scope '{applies_to}'")
        sign = 1 if direction.startswith("increas") else -1
        amount = _to_decimal(adj.get("amount"))
        gst_amount = _to_decimal(adj.get("gst") or adj.get("gst_amount"))

        bas_summary.setdefault(amount_label, Decimal("0.00"))
        bas_summary.setdefault(gst_label, Decimal("0.00"))
        bas_summary[amount_label] += sign * amount
        bas_summary[gst_label] += sign * gst_amount

        evidence.append(
            {
                "trigger": trigger,
                "direction": direction or "increasing",
                "applies_to": applies_to,
                "amount": amount,
                "gst": gst_amount,
                "labels": labels,
                "rule_hash": detail.get("rule_hash") or bucket.get("rule_hash"),
            }
        )

    return bas_summary, evidence
