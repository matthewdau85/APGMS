"""Payroll tax computation engine.

This module loads state rules from JSON descriptions and computes monthly
liabilities, grouped wage aggregates, and annual reconciliations. The
implementation intentionally keeps the rule format simple so that new
levies and rates can be introduced through the JSON definitions without
modifying code.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP, getcontext
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping

getcontext().prec = 28

_BASE_DIR = Path(__file__).resolve().parents[1]
_RULES_DIR = _BASE_DIR / "rules"


class RuleNotFoundError(FileNotFoundError):
    """Raised when a payroll tax rule file cannot be located."""


def load_rules(state: str, year: int) -> Dict[str, Any]:
    """Load the payroll tax rules for a given state and year."""
    state_key = state.lower()
    rules_path = _RULES_DIR / f"payroll_tax_{state_key}_{year}.json"
    if not rules_path.exists():
        raise RuleNotFoundError(f"No payroll tax rules for {state.upper()} {year} at {rules_path}")

    with rules_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def aggregate_group_wages(wage_records: Iterable[Mapping[str, Any]], state: str) -> Dict[str, Decimal]:
    """Aggregate wages for the provided state grouped by the supplied group keys."""
    state_upper = state.upper()
    grouped: Dict[str, Decimal] = {}
    for record in wage_records:
        nexus = record.get("nexus", state_upper)
        if nexus and str(nexus).upper() != state_upper:
            continue
        wages = _to_decimal(record.get("wages", 0))
        if wages <= 0:
            continue
        group_key = record.get("group") or record.get("entity") or "default"
        grouped[group_key] = grouped.get(group_key, Decimal("0")) + wages
    return grouped


def compute_monthly_liability(
    state: str,
    year: int,
    wage_records: Iterable[Mapping[str, Any]],
    pay_date: date | datetime | str,
) -> Dict[str, Any]:
    """Compute the monthly payroll tax liability for the given state.

    The function returns a dictionary describing the computation so that tests can
    assert against both the totals and the intermediate grouping calculations.
    """

    rules = load_rules(state, year)
    pay_date = _coerce_date(pay_date)

    group_totals = aggregate_group_wages(wage_records, state)
    total_wages = sum(group_totals.values(), start=Decimal("0"))

    monthly_threshold = _to_decimal(rules.get("thresholds", {}).get("monthly", 0))
    grouping_rules = rules.get("grouping", {})
    shared_threshold = grouping_rules.get("shared_threshold", True)

    taxable_by_group: Dict[str, Decimal] = {}
    if shared_threshold:
        for group, wages in group_totals.items():
            taxable_by_group[group] = _positive(wages - monthly_threshold)
    else:
        # If the threshold is not shared, apply it to each entity (or record) individually.
        for group, wages in group_totals.items():
            taxable_by_group[group] = _positive(wages - monthly_threshold)

    taxable_wages = sum(taxable_by_group.values(), start=Decimal("0"))
    tax_amount = _apply_rates(taxable_wages, rules.get("rates", []))

    levies: Dict[str, Decimal] = {}
    for levy in rules.get("levies", []):
        if _levy_active(levy, pay_date):
            base_selector = levy.get("apply_on", "taxable").lower()
            if base_selector == "total":
                base_amount = total_wages
            else:
                base_amount = taxable_wages
            levies[levy["name"]] = base_amount * _to_decimal(levy.get("rate", 0))

    total_liability = tax_amount + sum(levies.values(), start=Decimal("0"))

    return {
        "state": state.upper(),
        "period": pay_date.strftime("%Y-%m"),
        "total_wages": _round_currency(total_wages),
        "group_totals": {group: _round_currency(amount) for group, amount in group_totals.items()},
        "taxable_wages": _round_currency(taxable_wages),
        "taxable_wages_by_group": {group: _round_currency(amount) for group, amount in taxable_by_group.items()},
        "tax": _round_currency(tax_amount),
        "levies": {name: _round_currency(amount) for name, amount in levies.items()},
        "total_liability": _round_currency(total_liability),
    }


def annual_reconciliation(
    state: str,
    year: int,
    monthly_liabilities: Iterable[Mapping[str, Any]],
) -> Dict[str, Any]:
    """Perform a simple annual reconciliation based on monthly liabilities."""

    rules = load_rules(state, year)
    annual_threshold = _to_decimal(rules.get("thresholds", {}).get("annual", 0))

    total_wages = sum((_to_decimal(item.get("total_wages", 0)) for item in monthly_liabilities), start=Decimal("0"))
    taxable_wages = _positive(total_wages - annual_threshold)
    annual_tax = _apply_rates(taxable_wages, rules.get("rates", []))

    tax_paid = sum((_to_decimal(item.get("tax", 0)) for item in monthly_liabilities), start=Decimal("0"))
    levies_paid = sum(
        (
            _to_decimal(value)
            for item in monthly_liabilities
            for value in item.get("levies", {}).values()
        ),
        start=Decimal("0"),
    )

    balance = annual_tax - tax_paid

    return {
        "state": state.upper(),
        "year": year,
        "total_wages": _round_currency(total_wages),
        "taxable_wages": _round_currency(taxable_wages),
        "annual_tax": _round_currency(annual_tax),
        "tax_paid": _round_currency(tax_paid),
        "levies_paid": _round_currency(levies_paid),
        "balance": _round_currency(balance),
    }


def _coerce_date(value: date | datetime | str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value).date()
    raise TypeError(f"Unsupported date value: {value!r}")


def _levy_active(levy: Mapping[str, Any], pay_date: date) -> bool:
    start_raw = levy.get("effective_from")
    end_raw = levy.get("effective_to")

    start = datetime.fromisoformat(start_raw).date() if start_raw else date.min
    end = datetime.fromisoformat(end_raw).date() if end_raw else date.max

    return start <= pay_date <= end


def _apply_rates(amount: Decimal, rates: List[Mapping[str, Any]]) -> Decimal:
    amount = _to_decimal(amount)
    if amount <= 0 or not rates:
        return Decimal("0")

    ordered = sorted(
        rates,
        key=lambda r: _to_decimal(r.get("threshold")) if r.get("threshold") is not None else Decimal("Infinity"),
    )

    tax = Decimal("0")
    previous_limit = Decimal("0")

    for bracket in ordered:
        rate = _to_decimal(bracket.get("rate", 0))
        threshold = bracket.get("threshold")
        if threshold is None:
            slice_amount = amount - previous_limit
        else:
            limit = _to_decimal(threshold)
            if amount <= previous_limit:
                slice_amount = Decimal("0")
            else:
                slice_amount = min(amount, limit) - previous_limit
        if slice_amount <= 0:
            if threshold is not None:
                previous_limit = _to_decimal(threshold)
            continue
        tax += slice_amount * rate
        if threshold is None:
            break
        previous_limit = _to_decimal(threshold)
        if amount <= previous_limit:
            break
    return tax


def _positive(value: Decimal) -> Decimal:
    value = _to_decimal(value)
    return value if value > 0 else Decimal("0")


def _to_decimal(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def _round_currency(value: Decimal) -> float:
    value = _to_decimal(value)
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


__all__ = [
    "RuleNotFoundError",
    "load_rules",
    "aggregate_group_wages",
    "compute_monthly_liability",
    "annual_reconciliation",
]
