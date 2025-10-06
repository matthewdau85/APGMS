from __future__ import annotations

from dataclasses import dataclass
from bisect import bisect_right
from typing import Dict, List, Optional


def _round_half_up(value: float) -> int:
    if value >= 0:
        return int(value + 0.5)
    return -int(-value + 0.5)

@dataclass(frozen=True)
class PaygwBracket:
    min_cents: int
    max_cents: Optional[int]
    base_tax_cents: int
    rate_basis_points: int

@dataclass(frozen=True)
class PenaltyConfig:
    penalty_unit_cents: int
    unit_multiplier: int
    days_per_unit: int
    max_units: int
    gic_daily_rate_basis_points: int
    gic_cap_basis_points: Optional[int] = None
    total_cap_basis_points: Optional[int] = None

@dataclass(frozen=True)
class RatesVersion:
    name: str
    effective_from: str
    effective_to: Optional[str]
    paygw_brackets: List[PaygwBracket]
    gst_rate_basis_points: int
    penalty: PenaltyConfig
    checksum: str

_RATES: Dict[str, RatesVersion] = {}
_ACTIVE_VERSION_ID: Optional[str] = None

DEFAULT_VERSION_ID = "f02f0c33-57d2-4bb9-a2bd-6a5f5f7e6d4c"

DEFAULT_BRACKETS = [
    PaygwBracket(0, 1_820_000, 0, 0),
    PaygwBracket(1_820_001, 4_500_000, 0, 1_900),
    PaygwBracket(4_500_001, 12_000_000, 509_200, 3_250),
    PaygwBracket(12_000_001, 18_000_000, 2_946_700, 3_700),
    PaygwBracket(18_000_001, None, 5_166_700, 4_500),
]

DEFAULT_PENALTY = PenaltyConfig(
    penalty_unit_cents=31_300,
    unit_multiplier=1,
    days_per_unit=28,
    max_units=5,
    gic_daily_rate_basis_points=32,
    gic_cap_basis_points=7_500,
    total_cap_basis_points=25_000,
)

DEFAULT_CHECKSUM = "c984c6398f27f7553b610a8725fce80a2035e21efae2d1ce1273978038ff052e"


def register_rates_version(version_id: str, version: RatesVersion) -> None:
    _RATES[version_id] = version


def set_active_version(version_id: str) -> None:
    if version_id not in _RATES:
        raise KeyError(f"unknown rates version {version_id}")
    global _ACTIVE_VERSION_ID
    _ACTIVE_VERSION_ID = version_id


def get_active_version() -> RatesVersion:
    if _ACTIVE_VERSION_ID is None:
        raise RuntimeError("no active rates version")
    return _RATES[_ACTIVE_VERSION_ID]


def calc_paygw(income_cents: int, version_id: Optional[str] = None) -> int:
    if income_cents <= 0:
        return 0
    version = _RATES[version_id or _ACTIVE_VERSION_ID or DEFAULT_VERSION_ID]
    brackets = version.paygw_brackets
    mins = [b.min_cents for b in brackets]
    idx = bisect_right(mins, income_cents) - 1
    idx = max(0, min(idx, len(brackets) - 1))
    bracket = brackets[idx]
    max_cents = bracket.max_cents if bracket.max_cents is not None else income_cents
    if income_cents > max_cents and idx + 1 < len(brackets):
        bracket = brackets[idx + 1]
    taxable = max(0, income_cents - bracket.min_cents)
    marginal = _round_half_up(taxable * bracket.rate_basis_points / 10000)
    return bracket.base_tax_cents + marginal


def calc_gst(net_cents: int, version_id: Optional[str] = None) -> int:
    if net_cents <= 0:
        return 0
    version = _RATES[version_id or _ACTIVE_VERSION_ID or DEFAULT_VERSION_ID]
    return _round_half_up(net_cents * version.gst_rate_basis_points / 10000)


def calc_penalty(days_late: int, amount_cents: int, version_id: Optional[str] = None) -> int:
    if days_late <= 0 or amount_cents <= 0:
        return 0
    version = _RATES[version_id or _ACTIVE_VERSION_ID or DEFAULT_VERSION_ID]
    cfg = version.penalty
    blocks = (days_late + cfg.days_per_unit - 1) // cfg.days_per_unit
    units = min(blocks * cfg.unit_multiplier, cfg.max_units)
    ftl = units * cfg.penalty_unit_cents
    gic_raw = _round_half_up(amount_cents * cfg.gic_daily_rate_basis_points / 10000 * days_late)
    gic_cap = None if cfg.gic_cap_basis_points is None else _round_half_up(amount_cents * cfg.gic_cap_basis_points / 10000)
    gic = min(gic_raw, gic_cap) if gic_cap is not None else gic_raw
    total = ftl + gic
    if cfg.total_cap_basis_points is not None:
        cap = _round_half_up(amount_cents * cfg.total_cap_basis_points / 10000)
        total = min(total, cap)
    return total


register_rates_version(
    DEFAULT_VERSION_ID,
    RatesVersion(
        name="FY25 resident schedules",
        effective_from="2024-07-01",
        effective_to=None,
        paygw_brackets=DEFAULT_BRACKETS,
        gst_rate_basis_points=1_000,
        penalty=DEFAULT_PENALTY,
        checksum=DEFAULT_CHECKSUM,
    ),
)
set_active_version(DEFAULT_VERSION_ID)
