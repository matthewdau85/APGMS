"""Core tax engine orchestration helpers."""
from __future__ import annotations

from datetime import date, timedelta
import re
from typing import Any, Dict, List, Optional, Tuple

from .domains import payg_w
from .rules.loader import (
    RuleDocument,
    build_rules_version_payload,
    load_rule_documents,
    load_rules_payload,
)

_PERIOD_MONTH = re.compile(r"^(?P<year>\d{4})-(?P<month>\d{2})$")
_PERIOD_QUARTER = re.compile(r"^(?P<year>\d{4})-Q(?P<quarter>[1-4])$")
_PERIOD_FBT = re.compile(r"^(?P<year>\d{4})-FBT$")


def _end_of_month(year: int, month: int) -> date:
    if month == 12:
        return date(year, 12, 31)
    next_month = date(year, month + 1, 1)
    return next_month - timedelta(days=1)


def _resolve_month(period_id: str) -> Optional[Tuple[date, date]]:
    match = _PERIOD_MONTH.match(period_id)
    if not match:
        return None
    year = int(match.group("year"))
    month = int(match.group("month"))
    start = date(year, month, 1)
    end = _end_of_month(year, month)
    return start, end


def _resolve_quarter(period_id: str, calendars: Dict[str, Any]) -> Optional[Tuple[date, date]]:
    match = _PERIOD_QUARTER.match(period_id)
    if not match:
        return None
    quarter_key = f"Q{match.group('quarter')}"
    year = int(match.group("year"))
    quarter_defs = (
        calendars.get("calendars", {})
        .get("bas", {})
        .get("quarterly", {})
        .get("quarters", {})
    )
    cfg = quarter_defs.get(quarter_key)
    if not cfg:
        return None
    start_year = year
    end_year = year
    start_month = int(cfg["start_month"])
    end_month = int(cfg["end_month"])
    if start_month > end_month:
        # Quarter wraps the calendar year (e.g. Jan–Mar described with start_month 10)
        end_year = year
        start_year = year - 1
    start = date(start_year, start_month, int(cfg.get("start_day", 1)))
    end = date(end_year, end_month, int(cfg.get("end_day", _end_of_month(end_year, end_month).day)))
    return start, end


def _resolve_fbt(period_id: str, calendars: Dict[str, Any]) -> Optional[Tuple[date, date]]:
    match = _PERIOD_FBT.match(period_id)
    if not match:
        return None
    year = int(match.group("year"))
    cfg = calendars.get("calendars", {}).get("fbt", {}).get("annual", {})
    if not cfg:
        return None
    start_year = year - 1
    start = date(start_year, int(cfg.get("start_month", 4)), int(cfg.get("start_day", 1)))
    end = date(year, int(cfg.get("end_month", 3)), int(cfg.get("end_day", 31)))
    return start, end


def resolve_period_bounds(period_id: str, calendars: Optional[Dict[str, Any]] = None) -> Tuple[str, str]:
    """Return inclusive ISO8601 bounds for a tax period."""

    if calendars is None:
        calendars = load_rules_payload("calendars.json")

    period_id = period_id or ""
    for resolver in (
        _resolve_month,
        lambda pid: _resolve_quarter(pid, calendars),
        lambda pid: _resolve_fbt(pid, calendars),
    ):
        result = resolver(period_id)
        if result:
            start, end = result
            return start.isoformat(), end.isoformat()

    # Fallback: treat as instantaneous period.
    return period_id, period_id


def build_evidence_segments(period_id: str, rule_docs: Dict[str, RuleDocument]) -> List[Dict[str, Any]]:
    effective_from, effective_to = resolve_period_bounds(period_id)
    segments: List[Dict[str, Any]] = []
    for name, doc in rule_docs.items():
        if not name.startswith("payg_w"):
            # Only include computation-critical rules; calendars inform period math but
            # aren't directly part of PAYG withholding calculations.
            continue
        segments.append(
            {
                "effective_from": effective_from,
                "effective_to": effective_to,
                "rules_sha256": doc.sha256,
            }
        )
    return segments


def compute_payg_withholding(event: Dict[str, Any]) -> Dict[str, Any]:
    rules_payload = load_rules_payload("payg_w_2024_25.json")
    return payg_w.compute(event, rules_payload)


def compute_tax_event(event: Dict[str, Any]) -> Dict[str, Any]:
    """Compute PAYG withholding and attach version metadata."""

    rule_docs = load_rule_documents()
    payg_result = compute_payg_withholding(event)
    segments = build_evidence_segments(event.get("period") or "", rule_docs)
    version_payload = build_rules_version_payload()

    return {
        "id": event.get("id"),
        "entity": event.get("entity"),
        "period": event.get("period"),
        "outcome": "ok",
        "results": {
            "payg_w": payg_result,
        },
        "evidence": {
            "segments": segments,
        },
        "rules": version_payload,
    }


__all__ = [
    "compute_tax_event",
    "build_evidence_segments",
    "resolve_period_bounds",
    "compute_payg_withholding",
]
