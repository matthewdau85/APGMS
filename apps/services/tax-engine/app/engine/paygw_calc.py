"""PAYG withholding calculator covering multiple residency classes and offsets."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from .rounding import round_decimal, round_to_cents, to_float

PERIODS_PER_YEAR: Dict[str, int] = {
    "weekly": 52,
    "fortnightly": 26,
    "monthly": 12,
    "quarterly": 4,
}


@dataclass(frozen=True)
class Bracket:
    threshold: Decimal
    limit: Optional[Decimal]
    rate: Decimal
    base: Decimal

    @classmethod
    def from_dict(cls, data: Dict[str, float]) -> "Bracket":
        threshold = Decimal(str(data.get("threshold", 0)))
        limit = data.get("limit")
        limit_dec = Decimal(str(limit)) if limit is not None else None
        rate = Decimal(str(data.get("rate", 0)))
        base_val = Decimal(str(data.get("base", 0)))
        return cls(threshold=threshold, limit=limit_dec, rate=rate, base=base_val)


@dataclass(frozen=True)
class Table:
    brackets: List[Bracket]
    rounding_increment: Decimal
    rounding_mode: str

    def withholding(self, gross: Decimal) -> Decimal:
        for bracket in self.brackets:
            if bracket.limit is None or gross <= bracket.limit:
                taxable = gross - bracket.threshold
                if taxable <= 0:
                    tax = Decimal("0")
                else:
                    tax = bracket.base + bracket.rate * taxable
                tax = max(Decimal("0"), tax)
                tax = round_to_cents(tax)
                return round_decimal(tax, increment=self.rounding_increment, mode=self.rounding_mode)
        return Decimal("0")


def _load_json(path: Path) -> Dict[str, object]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _rules_dir(year: str) -> Path:
    base = Path(__file__).resolve().parent.parent / "rules" / f"payg_w_{year}"
    if not base.exists():
        raise FileNotFoundError(f"PAYG rules for {year} not found at {base}")
    return base


@lru_cache(maxsize=None)
def _load_resident_tables(year: str, period: str) -> Dict[str, Table]:
    data = _load_json(_rules_dir(year) / f"resident_{period}.json")
    default_round = data.get("default_rounding", {"mode": "NEAREST", "increment": 1})
    tables: Dict[str, Table] = {}
    for name, cfg in data.get("tables", {}).items():
        rounding_cfg = cfg.get("rounding", default_round)
        tables[name] = Table(
            brackets=[Bracket.from_dict(b) for b in cfg.get("brackets", [])],
            rounding_increment=Decimal(str(rounding_cfg.get("increment", 1))),
            rounding_mode=str(rounding_cfg.get("mode", "NEAREST")),
        )
    return tables


@lru_cache(maxsize=None)
def _load_generic_table(year: str, filename: str) -> Table:
    data = _load_json(_rules_dir(year) / filename)
    rounding_cfg = data.get("rounding", {"mode": "NEAREST", "increment": 1})
    return Table(
        brackets=[Bracket.from_dict(b) for b in data.get("brackets", [])],
        rounding_increment=Decimal(str(rounding_cfg.get("increment", 1))),
        rounding_mode=str(rounding_cfg.get("mode", "NEAREST")),
    )


@lru_cache(maxsize=None)
def _load_no_tfn(year: str) -> Dict[str, Dict[str, object]]:
    return _load_json(_rules_dir(year) / "no_tfn_withholding.json")


@lru_cache(maxsize=None)
def _load_stsl(year: str) -> Dict[str, object]:
    return _load_json(_rules_dir(year) / "stsl_2024.json")


@lru_cache(maxsize=None)
def _load_offset(year: str, name: str) -> Dict[str, object]:
    return _load_json(_rules_dir(year) / "offsets" / f"{name}_2024.json")


def _calc_offsets(period: str, event: Dict[str, object], year: str) -> Decimal:
    per_period = Decimal("0")
    periods = PERIODS_PER_YEAR.get(period)
    if not periods:
        return per_period

    offsets_cfg = event.get("offsets", {}) or {}

    if offsets_cfg.get("sapto", {}).get("eligible"):
        sapto_rules = _load_offset(year, "sapto")
        rebate_income = Decimal(str(offsets_cfg["sapto"].get("rebate_income", 0)))
        shade_out_threshold = Decimal(str(sapto_rules.get("shade_out_threshold", 0)))
        max_offset = Decimal(str(sapto_rules.get("max_offset", 0)))
        shade_out_rate = Decimal(str(sapto_rules.get("shade_out_rate", 0)))
        reduction = max(Decimal("0"), rebate_income - shade_out_threshold) * shade_out_rate
        annual_offset = max(Decimal("0"), max_offset - reduction)
        per_period += annual_offset / periods

    zone_cfg = offsets_cfg.get("zone", {})
    if zone_cfg:
        zone_rules = _load_offset(year, "zone")
        zone_key = str(zone_cfg.get("zone", "")).lower()
        amount = Decimal("0")
        if zone_key == "zone_a":
            amount = Decimal(str(zone_rules.get("zone_a", 0)))
        elif zone_key == "zone_b":
            amount = Decimal(str(zone_rules.get("zone_b", 0)))
        elif zone_key == "special":
            amount = Decimal(str(zone_rules.get("special", 0)))
        per_period += amount / periods

    if offsets_cfg.get("seniors", {}).get("eligible"):
        seniors_rules = _load_offset(year, "seniors")
        income = Decimal(str(offsets_cfg["seniors"].get("income", 0)))
        threshold = Decimal(str(seniors_rules.get("rebate_income_threshold", 0)))
        max_offset = Decimal(str(seniors_rules.get("max_offset", 0)))
        per_period += (max_offset if income <= threshold else Decimal("0")) / periods

    manual = offsets_cfg.get("manual")
    if manual is not None:
        per_period += Decimal(str(manual))

    return round_to_cents(per_period)


def _calc_stsl(period: str, gross: Decimal, event: Dict[str, object], year: str) -> Decimal:
    if not event.get("stsl"):
        return Decimal("0")
    stsl_cfg = _load_stsl(year)
    payment_date_raw = event.get("payment_date")
    if payment_date_raw:
        pay_date = date.fromisoformat(str(payment_date_raw))
        indexation_date = date.fromisoformat(str(stsl_cfg.get("indexation_date")))
        if pay_date < indexation_date:
            return Decimal("0")
    annualised = gross * PERIODS_PER_YEAR.get(period, 0)
    rate = Decimal("0")
    for tier in stsl_cfg.get("thresholds", []):
        min_val = Decimal(str(tier.get("min", 0)))
        max_val = tier.get("max")
        max_dec = Decimal(str(max_val)) if max_val is not None else None
        if annualised >= min_val and (max_dec is None or annualised < max_dec):
            rate = Decimal(str(tier.get("rate", 0)))
            break
    if rate == 0:
        return Decimal("0")
    rounding_cfg = stsl_cfg.get("rounding", {"mode": "NEAREST", "increment": 1})
    raw = gross * rate
    raw = round_to_cents(raw)
    return round_decimal(raw, increment=Decimal(str(rounding_cfg.get("increment", 1))), mode=str(rounding_cfg.get("mode", "NEAREST")))


def _select_resident_table(year: str, period: str, tax_free_threshold: bool) -> Table:
    tables = _load_resident_tables(year, period)
    key = "with_tax_free_threshold" if tax_free_threshold else "no_tax_free_threshold"
    if key not in tables:
        raise KeyError(f"No table '{key}' for {period}")
    return tables[key]


def _load_residency_table(year: str, residency: str, period: str) -> Table:
    if residency == "foreign_resident":
        return _load_generic_table(year, f"foreign_resident_{period}.json")
    if residency == "working_holiday":
        return _load_generic_table(year, f"working_holiday_maker_{period}.json")
    raise ValueError(f"Unsupported residency '{residency}'")


def calculate(pay_event: Dict[str, object], *, year: str = "2024_25") -> Dict[str, object]:
    period = str(pay_event.get("period", "weekly")).lower()
    if period not in PERIODS_PER_YEAR:
        raise ValueError(f"Unsupported pay period '{period}'")

    gross = Decimal(str(pay_event.get("gross", 0)))
    residency = str(pay_event.get("residency", "resident"))

    explain: List[str] = [f"period={period}", f"residency={residency}", f"gross={gross}"]

    if residency == "resident":
        tax_free_threshold = bool(pay_event.get("tax_free_threshold", True))
        table = _select_resident_table(year, period, tax_free_threshold)
        base_withholding = table.withholding(gross)
        explain.append(f"tax_free_threshold={tax_free_threshold}")
    elif residency in {"foreign_resident", "working_holiday"}:
        table = _load_residency_table(year, residency, period)
        base_withholding = table.withholding(gross)
    elif residency == "no_tfn":
        rate_cfg = _load_no_tfn(year)["rates"][period]
        rate = Decimal(str(rate_cfg.get("rate", 0)))
        rounding_cfg = rate_cfg.get("rounding", {"mode": "NEAREST", "increment": 1})
        raw = gross * rate
        raw = round_to_cents(raw)
        base_withholding = round_decimal(raw, increment=Decimal(str(rounding_cfg.get("increment", 1))), mode=str(rounding_cfg.get("mode", "NEAREST")))
    else:
        raise ValueError(f"Unknown residency '{residency}'")

    offsets = _calc_offsets(period, pay_event, year)
    extra = Decimal(str(pay_event.get("extra_withholding", 0)))
    adjustments = base_withholding - offsets + extra
    if adjustments < 0:
        adjustments = Decimal("0")
    adjustments = round_decimal(round_to_cents(adjustments), increment=Decimal("1"), mode="NEAREST")

    stsl_amount = _calc_stsl(period, gross, pay_event, year)
    total = adjustments + stsl_amount

    return {
        "gross": to_float(round_to_cents(gross)),
        "base_withholding": to_float(base_withholding),
        "offsets": to_float(offsets),
        "extra_withholding": to_float(round_to_cents(extra)),
        "stsl": to_float(stsl_amount),
        "withholding": to_float(adjustments),
        "total_withholding": to_float(total),
        "explain": explain,
    }


def withholding_table(year: str, residency: str, period: str, *, tax_free_threshold: bool = True) -> Iterable[Bracket]:
    """Expose the brackets for property-based testing."""
    if residency == "resident":
        table = _select_resident_table(year, period, tax_free_threshold)
        return table.brackets
    if residency in {"foreign_resident", "working_holiday"}:
        table = _load_residency_table(year, residency, period)
        return table.brackets
    raise ValueError("withholding_table is only available for resident, foreign_resident and working_holiday tables")
