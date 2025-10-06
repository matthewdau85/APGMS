from __future__ import annotations
"""PAYG withholding domain orchestrating PAYG tables and ETP calculations."""

from typing import Any, Dict

from ..engine import etp_calc, paygw_calc

DEFAULT_YEAR = "2024_25"


def compute(event: Dict[str, Any], rules: Dict[str, Any] | None = None) -> Dict[str, Any]:
    pay_event = event.get("payg_w", {}) or {}
    year = str((rules or {}).get("year", DEFAULT_YEAR))

    response: Dict[str, Any] = {}

    if pay_event:
        response["payg_w"] = paygw_calc.calculate(pay_event, year=year)

    etp_event = event.get("etp") or event.get("lump_sum")
    if etp_event:
        response["etp"] = etp_calc.calculate(etp_event, year=year)

    return response
