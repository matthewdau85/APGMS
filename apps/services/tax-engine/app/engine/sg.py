from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence, Tuple

RULES_DIR = Path(__file__).resolve().parents[1] / "rules"
_DECIMAL_ZERO = Decimal("0")
_TWO_PLACES = Decimal("0.01")
_ROADMAP: List[RoadmapEntry] = []


def _to_decimal(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if value is None:
        return _DECIMAL_ZERO
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    return Decimal(str(value))


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class QuarterRule:
    quarter: str
    sg_percent: Decimal
    max_contribution_base: Decimal
    ote_inclusions: Tuple[str, ...]
    ote_exclusions: Tuple[str, ...]


@dataclass(frozen=True)
class RoadmapEntry:
    effective_from: date
    sg_percent: Decimal


@lru_cache(maxsize=1)
def load_quarter_rules() -> Dict[str, QuarterRule]:
    rules: Dict[str, QuarterRule] = {}
    global _ROADMAP
    roadmap_entries: List[RoadmapEntry] = list(_ROADMAP)

    for path in sorted(RULES_DIR.glob("sg_*.json")):
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        entries: Sequence[Mapping[str, Any]]
        defaults: Mapping[str, Any]
        if isinstance(payload, dict) and "quarters" in payload:
            entries = payload.get("quarters", [])
            defaults = {
                "ote_inclusions": payload.get("ote_inclusions", []),
                "ote_exclusions": payload.get("ote_exclusions", []),
            }
            roadmap_entries.extend(_normalise_roadmap(payload.get("roadmap", [])))
        elif isinstance(payload, list):
            entries = payload
            defaults = {}
        else:
            continue
        for entry in entries:
            quarter = str(entry["quarter"]).strip()
            sg_percent = _to_decimal(entry["sg_percent"])
            max_contribution_base = _to_decimal(entry["max_contribution_base"])
            ote_inclusions = tuple(entry.get("ote_inclusions", defaults.get("ote_inclusions", [])))
            ote_exclusions = tuple(entry.get("ote_exclusions", defaults.get("ote_exclusions", [])))
            rules[quarter] = QuarterRule(
                quarter=quarter,
                sg_percent=sg_percent,
                max_contribution_base=max_contribution_base,
                ote_inclusions=ote_inclusions,
                ote_exclusions=ote_exclusions,
            )
            roadmap_entries.extend(_normalise_roadmap(entry.get("roadmap", [])))

    if not rules:
        raise FileNotFoundError("No SG rules found in rules directory")

    roadmap_entries = _dedupe_roadmap(roadmap_entries)
    _ROADMAP = roadmap_entries
    return rules


def _normalise_roadmap(entries: Sequence[Mapping[str, Any]]) -> List[RoadmapEntry]:
    normalised: List[RoadmapEntry] = []
    for entry in entries or []:
        normalised.append(
            RoadmapEntry(
                effective_from=_parse_date(entry["effective_from"]),
                sg_percent=_to_decimal(entry["sg_percent"]),
            )
        )
    return normalised


def _dedupe_roadmap(entries: Sequence[RoadmapEntry]) -> List[RoadmapEntry]:
    unique: Dict[date, RoadmapEntry] = {}
    for entry in entries:
        unique[entry.effective_from] = entry
    ordered = sorted(unique.values(), key=lambda item: item.effective_from)
    return ordered


def roadmap() -> Tuple[RoadmapEntry, ...]:
    if not _ROADMAP:
        load_quarter_rules()
    return tuple(_ROADMAP)


def resolve_rate_for_date(moment: date) -> Decimal:
    schedule = roadmap()
    if not schedule:
        raise FileNotFoundError("SG roadmap not initialised")
    applicable = schedule[0].sg_percent
    for entry in schedule:
        if moment >= entry.effective_from:
            applicable = entry.sg_percent
        else:
            break
    return applicable


def _parse_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    return datetime.strptime(str(value), "%Y-%m-%d").date()


def _round_float(value: Decimal) -> float:
    return float(_quantize(value))


def _calculate_ote(earnings: Iterable[Mapping[str, Any]], rule: QuarterRule) -> Tuple[Decimal, List[Tuple[str, Decimal]]]:
    include_set = set(x.lower() for x in rule.ote_inclusions)
    exclude_set = set(x.lower() for x in rule.ote_exclusions)
    total = _DECIMAL_ZERO
    breakdown: List[Tuple[str, Decimal]] = []
    for entry in earnings:
        code_raw = str(entry.get("code", ""))
        code = code_raw.lower()
        amount = _to_decimal(entry.get("amount", 0))
        if amount <= _DECIMAL_ZERO:
            continue
        if code in exclude_set:
            continue
        if include_set and code not in include_set:
            continue
        total += amount
        breakdown.append((code_raw.upper(), amount))
    return total, breakdown


def compute(event: Mapping[str, Any]) -> Dict[str, Any]:
    quarter = str(event.get("quarter", "")).strip()
    if not quarter:
        raise ValueError("quarter is required")
    rules = load_quarter_rules()
    if quarter not in rules:
        raise KeyError(f"No SG rules for quarter {quarter}")
    rule = rules[quarter]

    ote_total, breakdown = _calculate_ote(event.get("earnings", []), rule)
    ote_capped = min(ote_total, rule.max_contribution_base)
    sg_rate = rule.sg_percent
    required_contribution = _quantize(ote_capped * sg_rate)

    sacrifice = event.get("salary_sacrifice") or {}
    sac_pre = _quantize(_to_decimal(sacrifice.get("pre_tax", 0)))
    sac_post = _quantize(_to_decimal(sacrifice.get("post_tax", 0)))
    employer_recommended = _quantize(max(_DECIMAL_ZERO, required_contribution - sac_pre))
    package_total = employer_recommended + sac_pre + sac_post

    explain = [
        f"Quarter {quarter}: OTE {ote_total:.2f} capped to {ote_capped:.2f} (MCB {rule.max_contribution_base:.2f})",
        f"SG rate {float(sg_rate) * 100:.2f}% => required {required_contribution:.2f}",
    ]
    if sac_pre > _DECIMAL_ZERO or sac_post > _DECIMAL_ZERO:
        explain.append(
            f"Salary sacrifice pre-tax {sac_pre:.2f} post-tax {sac_post:.2f}; employer top-up {employer_recommended:.2f}"
        )

    return {
        "quarter": quarter,
        "sg_rate": float(sg_rate),
        "ote": _round_float(ote_total),
        "ote_capped": _round_float(ote_capped),
        "max_contribution_base": _round_float(rule.max_contribution_base),
        "required_contribution": _round_float(required_contribution),
        "salary_sacrifice": {
            "pre_tax": _round_float(sac_pre),
            "post_tax": _round_float(sac_post),
        },
        "recommended_employer_contribution": _round_float(employer_recommended),
        "package_total": _round_float(package_total),
        "ote_breakdown": [
            {"code": code, "amount": _round_float(amount)} for code, amount in breakdown
        ],
        "explain": explain,
    }
