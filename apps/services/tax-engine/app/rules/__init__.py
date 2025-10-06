from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List

from ..domains.utils import parse_date


RULES_DIR = Path(__file__).resolve()
if RULES_DIR.is_file():
    RULES_DIR = RULES_DIR.parent


@lru_cache(maxsize=1)
def _engine_rules() -> Dict[str, Any]:
    with open(RULES_DIR / "engine_rules.json", "r", encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=None)
def load_paygw_rules(filename: str) -> Dict[str, Any]:
    with open(RULES_DIR / filename, "r", encoding="utf-8") as f:
        return json.load(f)


@dataclass
class RuleSegment:
    effective_from: date
    to: date
    paygw: Dict[str, Any]
    paygi: Dict[str, Any]
    gst: Dict[str, Any]


def segments_for_period(period_start: date, period_end: date) -> tuple[List[RuleSegment], str]:
    rules = _engine_rules()
    version = rules.get("version", "unknown")
    segments: List[RuleSegment] = []
    for raw in rules.get("segments", []):
        seg_start = parse_date(raw.get("effective_from"))
        seg_end = parse_date(raw.get("to")) if raw.get("to") else date.max
        if seg_start is None:
            continue
        if seg_start > period_end or seg_end < period_start:
            continue
        start = max(period_start, seg_start)
        end = min(period_end, seg_end)
        paygw_rules = load_paygw_rules(raw.get("paygw_rules", "payg_w_2024_25.json"))
        segments.append(
            RuleSegment(
                effective_from=start,
                to=end,
                paygw=paygw_rules,
                paygi=raw.get("paygi", {}),
                gst=raw.get("gst", {}),
            )
        )
    segments.sort(key=lambda s: s.effective_from)
    return segments, version
