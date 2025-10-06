from __future__ import annotations

from typing import Any, Dict, Tuple


PeriodKey = Tuple[str, str]

_PERIOD_DATA: Dict[PeriodKey, Dict[str, Any]] = {}


def set_period_data(abn: str, period_id: str, data: Dict[str, Any]) -> None:
    _PERIOD_DATA[(abn, period_id)] = data


def get_period_data(abn: str, period_id: str) -> Dict[str, Any] | None:
    return _PERIOD_DATA.get((abn, period_id))


def clear() -> None:
    _PERIOD_DATA.clear()
