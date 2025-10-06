from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Dict, Iterable

_RULES_DIR = Path(__file__).resolve().parent / "rules"


def _load_json(name: str) -> Dict[str, Any]:
    path = _RULES_DIR / name
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _ato_round(value: Decimal, *, whole_dollars: bool = True) -> Decimal:
    cents = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if whole_dollars:
        return cents.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return cents


def payg_withholding(
    gross: float,
    *,
    period: str = "weekly",
    tax_free_threshold: bool = True,
    stsl: bool = False,
    rules: Dict[str, Any] | None = None,
) -> int:
    """Return withholding in whole dollars for the supplied gross amount."""

    data = rules or _load_json("payg_w_2024_25.json")
    formula = data.get("formula_progressive") or {}
    if period.lower() != (formula.get("period") or "").lower():
        raise ValueError(f"Unsupported period: {period}")
    if tax_free_threshold is False:
        raise NotImplementedError("Current schedule covers tax-free threshold only")

    gross_amt = Decimal(str(gross))
    withholding = Decimal("0")
    for bracket in formula.get("brackets") or []:
        upper = Decimal(str(bracket.get("up_to", "999999")))
        if gross_amt <= upper:
            a = Decimal(str(bracket.get("a", 0)))
            b = Decimal(str(bracket.get("b", 0)))
            fixed = Decimal(str(bracket.get("fixed", 0)))
            withholding = a * gross_amt - b + fixed
            break
    if withholding < 0:
        withholding = Decimal("0")

    rounding = formula.get("rounding") or data.get("rounding") or "ATO_DOLLAR"
    whole = rounding.upper() == "ATO_DOLLAR"
    withholding = _ato_round(withholding, whole_dollars=whole)

    if stsl:
        stsl_cfg = data.get("stsl") or {}
        threshold = Decimal(str(stsl_cfg.get("weekly_threshold", 0)))
        rate = Decimal(str(stsl_cfg.get("rate", 0)))
        if gross_amt > threshold and rate > 0:
            stsl_amount = (gross_amt - threshold) * rate
            withholding += _ato_round(stsl_amount, whole_dollars=whole)

    return int(withholding)


def gst_labels(
    lines: Iterable[Dict[str, Any]],
    *,
    rules: Dict[str, Any] | None = None,
) -> Dict[str, int]:
    """Aggregate GST/BAS labels from invoice lines."""

    data = rules or _load_json("gst_rates.json")
    rates = {code.upper(): info.get("rate", 0) for code, info in (data.get("codes") or {}).items()}
    totals = {"W1": Decimal("0"), "W2": Decimal("0"), "1A": Decimal("0"), "1B": Decimal("0")}

    for line in lines:
        if not line:
            continue
        amount = Decimal(str(line.get("amount", 0)))
        if amount <= 0:
            continue
        kind = (line.get("kind") or line.get("type") or "sale").lower()
        tax_code = (line.get("tax_code") or "GST").upper()
        rate = Decimal(str(rates.get(tax_code, 0)))

        if kind == "wages":
            totals["W1"] += amount
            withheld = line.get("withheld") or line.get("withholding") or 0
            totals["W2"] += Decimal(str(withheld))
            continue

        if kind == "sale":
            totals["1A"] += amount * rate
        elif kind == "purchase":
            totals["1B"] += amount * rate
        elif kind == "adjustment":
            direction = (line.get("direction") or "debit").lower()
            if direction == "credit":
                totals["1B"] += amount * rate
            else:
                totals["1A"] += amount * rate

    whole = (data.get("rounding") or "ATO_DOLLAR").upper() == "ATO_DOLLAR"
    return {label: int(_ato_round(value, whole_dollars=whole)) for label, value in totals.items()}
