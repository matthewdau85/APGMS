from __future__ import annotations

import json
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, Optional

RULES_DIR = Path(__file__).resolve().parent


def _load_json(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _financial_year_from_date(dt: date) -> str:
    year = dt.year
    if dt.month < 7:
        start = year - 1
    else:
        start = year
    end = (start + 1) % 100
    return f"{start}-{end:02d}"


@lru_cache(maxsize=1)
def load_payg_rules_index() -> Dict[str, Dict]:
    """Return a dict keyed by financial year with PAYG-W rule payloads."""
    index: Dict[str, Dict] = {}
    for path in sorted(RULES_DIR.glob("payg_w_*.json")):
        payload = _load_json(path)
        fy = payload.get("financial_year")
        if not fy:
            continue
        index[fy] = payload
    return index


@lru_cache(maxsize=1)
def latest_financial_year() -> Optional[str]:
    rules = load_payg_rules_index()
    if not rules:
        return None
    ordered = sorted(
        rules.items(),
        key=lambda item: item[1].get("effective_from", ""),
    )
    return ordered[-1][0] if ordered else None


def resolve_financial_year(
    financial_year: Optional[str] = None,
    payment_date: Optional[str] = None,
) -> Optional[str]:
    """Choose the financial year from explicit request or payment date."""
    rules = load_payg_rules_index()
    if financial_year and financial_year in rules:
        return financial_year
    if payment_date:
        try:
            dt = datetime.fromisoformat(payment_date).date()
        except ValueError:
            dt = None
        if dt:
            fy = _financial_year_from_date(dt)
            if fy in rules:
                return fy
    return latest_financial_year()


@lru_cache(maxsize=1)
def load_gst_rules() -> Dict:
    candidates: Iterable[Path] = RULES_DIR.glob("gst_*.json")
    chosen: Optional[Path] = None
    for path in sorted(candidates):
        chosen = path
    return _load_json(chosen) if chosen else {"codes": {}}
