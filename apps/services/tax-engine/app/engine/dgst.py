from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

RULES_DIR = Path(__file__).resolve().parents[1] / "rules"
DGST_FILE_TEMPLATE = "gst_dgst_{year}.json"
DEFAULT_YEAR = 2025


def _to_decimal(value) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def load_dgst_rules(year: int = DEFAULT_YEAR, path: Path | None = None) -> Dict:
    rules_path = path or RULES_DIR / DGST_FILE_TEMPLATE.format(year=year)
    with open(rules_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def apply_dgst(
    bas_summary: Dict[str, Decimal],
    imports: Iterable[Dict],
    *,
    rules: Optional[Dict] = None,
) -> Tuple[Dict[str, Decimal], List[Dict]]:
    rules = rules or load_dgst_rules()
    labels = rules.get("labels", {})
    dgst_label = labels.get("dgst", "7")
    gst_label = labels.get("gst", "1A")
    bas_summary.setdefault(dgst_label, Decimal("0.00"))
    bas_summary.setdefault(gst_label, Decimal("0.00"))

    evidence: List[Dict] = []
    for entry in imports:
        amount = _to_decimal(entry.get("deferred_gst"))
        if not amount:
            continue
        bas_summary[dgst_label] += amount
        bas_summary[gst_label] += amount
        evidence.append(
            {
                "import_declaration": entry.get("import_declaration"),
                "period": entry.get("period"),
                "amount": amount,
                "labels": {"dgst": dgst_label, "gst": gst_label},
                "rule_hash": rules.get("rule_hash"),
            }
        )
    return bas_summary, evidence
