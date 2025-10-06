from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP, getcontext
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Mapping, Sequence

from . import RATES_VERSION

getcontext().prec = 28

RULES_DIR = Path(__file__).resolve().parent / "rules"
PAYG_RULES_PATH = RULES_DIR / "payg_w_2024_25.json"
GST_RULES_PATH = RULES_DIR / "gst_rates_2000_current.json"

PeriodLiteral = str
ResidentType = str


@dataclass(frozen=True)
class PaygBracket:
    up_to: Decimal
    a: Decimal
    b: Decimal
    fixed: Decimal = Decimal("0")

    @classmethod
    def from_dict(cls, payload: Mapping[str, object]) -> "PaygBracket":
        return cls(
            up_to=Decimal(str(payload["up_to"])),
            a=Decimal(str(payload.get("a", 0))),
            b=Decimal(str(payload.get("b", 0))),
            fixed=Decimal(str(payload.get("fixed", 0))),
        )

    def compute(self, income: Decimal) -> Decimal:
        amount = (self.a * income) - self.b + self.fixed
        return amount if amount > 0 else Decimal("0")


@dataclass(frozen=True)
class PeriodRule:
    brackets: Sequence[PaygBracket]
    rounding: str

    def amount_for(self, income: Decimal) -> Decimal:
        for bracket in self.brackets:
            if income <= bracket.up_to:
                return bracket.compute(income)
        return self.brackets[-1].compute(income)


@lru_cache(maxsize=1)
def _load_payg_rules() -> Mapping[str, object]:
    with PAYG_RULES_PATH.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if data.get("version") != RATES_VERSION:
        raise ValueError(
            f"PAYG rules version mismatch: expected {RATES_VERSION}, got {data.get('version')}"
        )
    return data


@lru_cache(maxsize=1)
def _load_gst_rules() -> Mapping[str, object]:
    with GST_RULES_PATH.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return data


def _period_rule(period: PeriodLiteral, resident_type: ResidentType, tfnt_claimed: bool) -> PeriodRule:
    rules = _load_payg_rules()
    periods = rules.get("periods", {})
    if period not in periods:
        raise ValueError(f"Unsupported period '{period}'")
    period_rules = periods[period]
    resident_rules = period_rules.get(resident_type)
    if resident_rules is None:
        raise ValueError(f"Unsupported resident type '{resident_type}' for period '{period}'")

    rule_key = "with_tfn" if tfnt_claimed and "with_tfn" in resident_rules else "no_tfn"
    selected = resident_rules.get(rule_key)
    if selected is None:
        raise ValueError(f"No PAYG brackets for key '{rule_key}' in period '{period}'")

    if isinstance(selected, Mapping) and "rate" in selected:
        rate = Decimal(str(selected["rate"]))
        return PeriodRule(brackets=[PaygBracket(up_to=Decimal("1e9"), a=rate, b=Decimal("0"))], rounding="HALF_UP")

    brackets = [PaygBracket.from_dict(p) for p in selected["brackets"]]
    rounding = selected.get("rounding", "HALF_UP")
    return PeriodRule(brackets=brackets, rounding=rounding)


def _round(value: Decimal, method: str) -> Decimal:
    if method == "NEAREST_DOLLAR":
        return value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if method == "CENT":
        return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def _stsl_amount(period: PeriodLiteral, income: Decimal, flags: Iterable[str]) -> Decimal:
    rules = _load_payg_rules()
    stsl_rules = rules.get("stsl", {})
    active_flags = {flag.lower() for flag in flags}
    allowed = {f.lower() for f in stsl_rules.get("flags", [])}
    if not active_flags.intersection(allowed):
        return Decimal("0")

    annual_factor = stsl_rules.get("annual_factor", {})
    period_factor = Decimal(str(annual_factor.get(period, 52)))
    annual_income = income * period_factor
    rate = Decimal("0")
    for bracket in stsl_rules.get("thresholds", []):
        up_to = Decimal(str(bracket["up_to"]))
        if annual_income <= up_to:
            rate = Decimal(str(bracket.get("rate", 0)))
            break
    else:
        if stsl_rules.get("thresholds"):
            last = stsl_rules["thresholds"][-1]
            rate = Decimal(str(last.get("rate", 0)))
    annual_amount = (annual_income * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    per_period = annual_amount / period_factor
    rounding = stsl_rules.get("rounding", "NEAREST_DOLLAR")
    return _round(per_period, rounding)


def payg_withholding(
    period: PeriodLiteral,
    tfnt_claimed: bool,
    resident_type: ResidentType,
    stsl_flags: Sequence[str],
    income: float | Decimal | int,
) -> int:
    """Calculate PAYG withholding using the published brackets."""

    if income is None:
        raise ValueError("income is required")
    try:
        income_decimal = Decimal(str(income))
    except Exception as exc:  # pragma: no cover - defensive
        raise ValueError("income must be numeric") from exc

    if income_decimal <= 0:
        return 0

    period_rule = _period_rule(period, resident_type, tfnt_claimed)
    base_amount = period_rule.amount_for(income_decimal)
    total = _round(base_amount, period_rule.rounding)
    stsl_amount = _stsl_amount(period, income_decimal, stsl_flags)
    total += stsl_amount
    return int(total)


def gst_labels(invoice_lines: Sequence[Mapping[str, object]], basis: str = "cash") -> Mapping[str, int]:
    """Aggregate invoice lines into BAS labels following ATO rounding rules."""

    rules = _load_gst_rules()
    basis = basis.lower()
    if basis not in rules.get("basis_flags", ["cash", "accrual"]):
        raise ValueError("Unknown basis")

    totals = {label: Decimal("0") for label in ["G1", "G2", "G3", "G10", "G11", "1A", "1B"]}
    rate_lookup = rules.get("categories", {})

    def should_recognise(line: Mapping[str, object]) -> bool:
        if basis == "accrual":
            return True
        return bool(line.get("paid", False))

    for line in invoice_lines:
        if not should_recognise(line):
            continue
        line_type = (str(line.get("type")) or "").lower()
        if line_type not in {"sale", "purchase"}:
            continue
        category = str(line.get("tax_code") or "GST").upper()
        cat_rules = rate_lookup.get(category, rate_lookup.get("GST", {}))
        amount = Decimal(str(line.get("amount", 0)))
        if amount <= 0:
            continue
        rate = Decimal(str(cat_rules.get("rate", rules.get("standard_rate", 0.1))))
        if line_type == "sale":
            totals["G1"] += amount
            if cat_rules.get("bas_label") == "G2":
                totals["G2"] += amount
            elif cat_rules.get("bas_label") == "G3":
                totals["G3"] += amount
            elif cat_rules.get("bas_label") == "G0":
                pass
            if rate > 0:
                gst = (amount * rate / (Decimal("1") + rate)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                totals["1A"] += gst
        else:
            if bool(line.get("capital", False)):
                totals["G10"] += amount
            else:
                totals["G11"] += amount
            if rate > 0:
                gst = (amount * rate / (Decimal("1") + rate)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                totals["1B"] += gst

    return {key: int(totals[key].quantize(Decimal("1"), rounding=ROUND_HALF_UP)) for key in totals}
