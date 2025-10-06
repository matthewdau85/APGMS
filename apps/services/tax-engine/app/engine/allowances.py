"""Allowance calculation helpers.

The helpers defined here take allowance payment inputs and return a rich
classification of taxable versus exempt components together with the correct
Single Touch Payroll (STP) category code that the caller should report.

The module relies on JSON rule files that live alongside the tax-engine app in
``app/rules``.  The rule data captures benchmark caps for the current financial
year.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
import json

RULES_DIR = Path(__file__).resolve().parent.parent / "rules"


class AllowanceRuleError(ValueError):
    """Raised when an allowance rule cannot be resolved."""


@dataclass(frozen=True)
class CentsPerKmRule:
    tier: str
    rate_cents: Decimal
    max_kilometres: Decimal
    stp_category: str
    description: str | None = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CentsPerKmRule":
        try:
            tier = data["tier"]
            rate = Decimal(str(data["rate_cents"]))
            max_km = Decimal(str(data.get("max_km", data.get("max_kilometres", 0))))
            stp = data.get("stp_category") or "CentsPerKilometre"
        except KeyError as exc:  # pragma: no cover - defensive
            raise AllowanceRuleError(f"Missing key in cents per km rule: {exc}") from exc
        return cls(
            tier=tier,
            rate_cents=rate,
            max_kilometres=max_km,
            stp_category=stp,
            description=data.get("description"),
        )


@dataclass(frozen=True)
class BenchmarkRule:
    tier: str
    stp_category: str
    metro_enabled: bool
    remote_enabled: bool
    caps: Dict[str, Decimal]
    description: str | None = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BenchmarkRule":
        try:
            tier = data["tier"]
            stp = data.get("stp_category") or "OtherAllowances"
            caps_raw = data.get("caps") or {}
        except KeyError as exc:  # pragma: no cover - defensive
            raise AllowanceRuleError(f"Missing key in benchmark rule: {exc}") from exc

        caps = {
            loc.lower(): Decimal(str(amount))
            for loc, amount in caps_raw.items()
            if amount is not None
        }
        return cls(
            tier=tier,
            stp_category=stp,
            metro_enabled=bool(data.get("metro", True)),
            remote_enabled=bool(data.get("remote", True)),
            caps=caps,
            description=data.get("description"),
        )


@dataclass(frozen=True)
class AllowanceResult:
    claimed_cents: int
    exempt_cents: int
    taxable_cents: int
    stp_category: str
    tier: str
    notes: Iterable[str]


def _quantize_cents(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _load_rules_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise AllowanceRuleError(f"Allowance rules file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_allowance_rules(year: str | None = None) -> Dict[str, Any]:
    """Load the allowance rules JSON for a financial year.

    Parameters
    ----------
    year:
        The year suffix (e.g. ``"2024_25"``).  When omitted the loader attempts
        to use the newest file in the rules directory.
    """

    if year:
        target = RULES_DIR / f"allowances_{year}.json"
        return _load_rules_file(target)

    candidates = sorted(RULES_DIR.glob("allowances_*.json"))
    if not candidates:
        raise AllowanceRuleError("No allowance rule files present")
    return _load_rules_file(candidates[-1])


def _resolve_cpk_rule(rules: Dict[str, Any], tier: str) -> CentsPerKmRule:
    tier_lower = tier.lower()
    data = rules.get("cents_per_km", {}).get("tiers", [])
    for item in data:
        rule = CentsPerKmRule.from_dict(item)
        if rule.tier.lower() == tier_lower:
            return rule
    raise AllowanceRuleError(f"No cents-per-kilometre rule configured for tier '{tier}'")


def _resolve_benchmark_rule(rules: Dict[str, Any], kind: str, tier: str) -> BenchmarkRule:
    tier_lower = tier.lower()
    kind_rules = rules.get("benchmarks", {}).get(kind.lower(), [])
    for item in kind_rules:
        rule = BenchmarkRule.from_dict(item)
        if rule.tier.lower() == tier_lower:
            return rule
    raise AllowanceRuleError(
        f"No benchmark rule configured for {kind!r} tier '{tier}'"
    )


def cents_per_km_allowance(
    kilometres: float | Decimal,
    rate_cents: float | Decimal,
    *,
    tier: str = "car",
    year: str | None = None,
    rules: Optional[Dict[str, Any]] = None,
) -> AllowanceResult:
    """Split a cents-per-kilometre allowance into taxable and exempt components."""

    rules_data = rules or load_allowance_rules(year)
    rule = _resolve_cpk_rule(rules_data, tier)

    km = Decimal(str(kilometres))
    rate = Decimal(str(rate_cents))
    claimed = km * rate

    eligible_km = min(km, rule.max_kilometres)
    exempt_rate = min(rate, rule.rate_cents)
    exempt_amount = eligible_km * exempt_rate

    taxable_amount = claimed - exempt_amount

    taxable_cents = max(_quantize_cents(taxable_amount), 0)
    exempt_cents = max(_quantize_cents(exempt_amount), 0)

    notes: list[str] = []
    if km > rule.max_kilometres:
        notes.append(
            f"Only the first {rule.max_kilometres} km are concessionally treated; "
            f"{km - rule.max_kilometres} km treated as taxable"
        )
    else:
        notes.append(
            f"Kilometres claimed within concessional cap of {rule.max_kilometres} km"
        )
    if rate > rule.rate_cents:
        notes.append(
            f"Amounts above {rule.rate_cents} cents per km are taxable"
        )
    else:
        notes.append(
            f"Rate does not exceed benchmark of {rule.rate_cents} cents per km"
        )

    return AllowanceResult(
        claimed_cents=_quantize_cents(claimed),
        exempt_cents=exempt_cents,
        taxable_cents=taxable_cents,
        stp_category=rule.stp_category,
        tier=rule.tier,
        notes=notes,
    )


def benchmark_allowance(
    kind: str,
    amount_cents: int,
    *,
    tier: str = "standard",
    location: str = "metro",
    year: str | None = None,
    rules: Optional[Dict[str, Any]] = None,
) -> AllowanceResult:
    """Apply benchmark rules for meal, travel or tool allowances."""

    rules_data = rules or load_allowance_rules(year)
    rule = _resolve_benchmark_rule(rules_data, kind, tier)
    location_key = location.lower()

    if location_key not in rule.caps:
        enabled_flag = "metro" if location_key == "metro" else "remote"
        raise AllowanceRuleError(
            f"Location '{location}' is not enabled for tier '{tier}' ({enabled_flag} not allowed)"
        )

    cap = rule.caps[location_key]
    claimed = Decimal(amount_cents)
    exempt_amount = min(claimed, cap)
    taxable_amount = max(claimed - cap, Decimal("0"))

    notes = [
        f"Benchmark cap for {kind} ({tier}) in {location_key} areas is {cap} cents",
    ]
    if taxable_amount > 0:
        notes.append("Excess above benchmark treated as taxable allowance")
    else:
        notes.append("Allowance is within benchmark and treated as exempt")

    return AllowanceResult(
        claimed_cents=int(claimed),
        exempt_cents=_quantize_cents(exempt_amount),
        taxable_cents=_quantize_cents(taxable_amount),
        stp_category=rule.stp_category,
        tier=rule.tier,
        notes=notes,
    )
