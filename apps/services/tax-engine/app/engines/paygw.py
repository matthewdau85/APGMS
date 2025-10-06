from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, Mapping

RULES_DIR = Path(__file__).resolve().parents[1] / "rules"


@lru_cache(maxsize=None)
def _load_period_tables(period: str) -> Iterable[Mapping[str, object]]:
    path = RULES_DIR / "payg_w_2024_25" / f"{period}.json"
    if not path.exists():
        raise ValueError(f"Unsupported period '{period}' for PAYG-W rules")
    with path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    tables = payload.get("tables")
    if tables is None:
        tables = [payload]
    return tuple(tables)


@lru_cache(maxsize=1)
def _load_flag_rules() -> Dict[str, Dict[str, object]]:
    path = RULES_DIR / "payg_w_flags.json"
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh).get("flags", {})


def _select_table(period: str, scale: str, tax_free_threshold: bool) -> Mapping[str, object]:
    scale = scale or "resident"
    for table in _load_period_tables(period):
        tbl_scale = table.get("scale", "resident")
        tbl_tft = bool(table.get("tax_free_threshold", True))
        if tbl_scale == scale and tbl_tft == bool(tax_free_threshold):
            return table
    # fall back to resident table regardless of TFT flag
    for table in _load_period_tables(period):
        if table.get("scale", "resident") == scale:
            return table
    for table in _load_period_tables(period):
        if bool(table.get("tax_free_threshold", True)) == bool(tax_free_threshold):
            return table
    return _load_period_tables(period)[0]


def _apply_flags(base_scale: str, flags: Mapping[str, object]) -> tuple[str, Decimal]:
    multiplier = Decimal("1")
    resolved_scale = base_scale or "resident"
    flag_rules = _load_flag_rules()
    for name, enabled in (flags or {}).items():
        if name == "tax_free_threshold" or not enabled:
            continue
        rule = flag_rules.get(name)
        if not rule:
            continue
        if rule.get("scale"):
            resolved_scale = str(rule["scale"])
        mult = rule.get("multiplier")
        if mult is not None:
            multiplier *= Decimal(str(mult))
    return resolved_scale, multiplier


def _pick_bracket(table: Mapping[str, object], gross_dollars: Decimal) -> Mapping[str, object]:
    brackets = table.get("brackets") or []
    selected = brackets[-1] if brackets else {}
    for bracket in brackets:
        up_to = bracket.get("up_to")
        if up_to is None:
            selected = bracket
            break
        if gross_dollars <= Decimal(str(up_to)):
            selected = bracket
            break
    return selected


def compute_withholding(request: Mapping[str, object]) -> int:
    gross_cents = int(request.get("gross") or 0)
    if gross_cents <= 0:
        return 0

    period = str(request.get("period") or "weekly").lower()
    base_scale = str(request.get("scale") or "resident")
    flags = request.get("flags") or {}
    tax_free_threshold = bool(flags.get("tax_free_threshold", True))

    resolved_scale, multiplier = _apply_flags(base_scale, flags)
    table = _select_table(period, resolved_scale, tax_free_threshold)

    gross_dollars = (Decimal(gross_cents) / Decimal(100)).quantize(Decimal("0.01"))
    bracket = _pick_bracket(table, gross_dollars)

    a = Decimal(str(bracket.get("a", "0")))
    b = Decimal(str(bracket.get("b", "0")))
    fixed = Decimal(str(bracket.get("fixed", "0")))

    withholding = a * gross_dollars - b + fixed
    if withholding < 0:
        withholding = Decimal("0")
    withholding *= multiplier
    if withholding < 0:
        withholding = Decimal("0")

    cents = (withholding * Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(cents)
