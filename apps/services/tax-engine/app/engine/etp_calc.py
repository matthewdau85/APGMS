"""ETP and lump sum withholding calculator following Schedule 11 style rules."""
from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Dict, List

from .rounding import round_decimal, round_to_cents, to_float


@dataclass
class ComponentResult:
    component_type: str
    amount: Decimal
    withheld: Decimal
    stp2_code: str

    def as_dict(self) -> Dict[str, float | str]:
        return {
            "type": self.component_type,
            "amount": to_float(self.amount),
            "withheld": to_float(self.withheld),
            "stp2_code": self.stp2_code,
        }


def _rules_dir(year: str) -> Path:
    base = Path(__file__).resolve().parent.parent / "rules" / f"payg_w_{year}"
    if not base.exists():
        raise FileNotFoundError(f"PAYG rules for {year} not found at {base}")
    return base


@lru_cache(maxsize=None)
def _load_lump_sum_rules(year: str) -> Dict[str, object]:
    with (_rules_dir(year) / "lump_sum_etp_2024.json").open("r", encoding="utf-8") as f:
        return json.load(f)


def _within_cap(amount: Decimal, remaining: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    allocated = min(amount, remaining)
    remaining -= allocated
    return allocated, amount - allocated, remaining


def calculate(event: Dict[str, object], *, year: str = "2024_25") -> Dict[str, object]:
    rules = _load_lump_sum_rules(year)
    rounding_cfg = rules.get("rounding", {"mode": "NEAREST", "increment": 1})
    round_increment = Decimal(str(rounding_cfg.get("increment", 1)))
    round_mode = str(rounding_cfg.get("mode", "NEAREST"))

    life_cap_remaining = Decimal(str(rules.get("life_benefit_cap", 0))) - Decimal(str(event.get("life_cap_used", 0)))
    death_cap_remaining = Decimal(str(rules.get("death_benefit_cap", 0))) - Decimal(str(event.get("death_cap_used", 0)))
    whole_income_remaining = Decimal(str(rules.get("whole_of_income_cap", 0))) - Decimal(str(event.get("whole_of_income_used", 0)))

    components: List[ComponentResult] = []
    stp2_totals: Dict[str, Decimal] = {}

    for comp in event.get("components", []):
        comp_type = str(comp.get("type"))
        amount = Decimal(str(comp.get("amount", 0)))
        if amount <= 0:
            continue
        stp2_code = rules.get("stp2_codes", {}).get(comp_type, comp_type)

        if comp_type in rules.get("lump_sum_rates", {}):
            rate = Decimal(str(rules["lump_sum_rates"][comp_type]))
            withheld = round_decimal(round_to_cents(amount * rate), increment=round_increment, mode=round_mode)
            result = ComponentResult(comp_type, amount, withheld, stp2_code)
        else:
            component_rule = rules.get("components", {}).get(comp_type)
            if not component_rule:
                raise ValueError(f"Unsupported ETP component '{comp_type}'")
            is_death = bool(comp.get("death_benefit", False))
            if is_death:
                allocated, excess, death_cap_remaining = _within_cap(amount, max(Decimal("0"), death_cap_remaining))
            else:
                allocated, excess, life_cap_remaining = _within_cap(amount, max(Decimal("0"), life_cap_remaining))

            within_whole, extra_whole, whole_income_remaining = _within_cap(allocated, max(Decimal("0"), whole_income_remaining))
            total_above_cap = excess + extra_whole

            preservation_key = "all"
            if "under_preservation" in component_rule or "at_or_above_preservation" in component_rule:
                preservation_key = "under_preservation" if str(comp.get("preservation", "under")).startswith("under") else "at_or_above_preservation"
            rate_info = component_rule[preservation_key]
            below_rate = Decimal(str(rate_info.get("below_cap", 0)))
            above_rate = Decimal(str(rate_info.get("above_cap", 0)))

            withheld = within_whole * below_rate + total_above_cap * above_rate
            withheld = round_decimal(round_to_cents(withheld), increment=round_increment, mode=round_mode)
            result = ComponentResult(comp_type, amount, withheld, stp2_code)

        components.append(result)
        stp2_totals[stp2_code] = stp2_totals.get(stp2_code, Decimal("0")) + result.withheld

    return {
        "components": [c.as_dict() for c in components],
        "total_withheld": to_float(sum((c.withheld for c in components), Decimal("0"))),
        "stp2_summary": {code: to_float(amount) for code, amount in stp2_totals.items()},
    }
