from __future__ import annotations

from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP, getcontext
from typing import Any, Dict, Tuple

from ..tax_rules import compute_withholding

getcontext().prec = 28


def _to_decimal(value: float | int | Decimal) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _round(amount: Decimal, mode: str = "HALF_UP") -> Decimal:
    rounding = ROUND_HALF_UP if mode == "HALF_UP" else ROUND_HALF_EVEN
    return amount.quantize(Decimal("0.01"), rounding=rounding)


def _percent_simple(gross: Decimal, rate: Decimal) -> Decimal:
    return (gross * rate).max(Decimal("0"))


def _flat_plus_percent(gross: Decimal, rate: Decimal, extra: Decimal) -> Decimal:
    return (gross * rate + extra).max(Decimal("0"))


def _bonus_marginal(regular_gross: Decimal, bonus: Decimal, params: Dict[str, Any]) -> Decimal:
    base = compute_withholding(regular_gross + bonus, params.get("period", "weekly"), params.get("residency", "resident"), params)
    only_base = compute_withholding(regular_gross, params.get("period", "weekly"), params.get("residency", "resident"), params)
    return Decimal(base - only_base) / 100


def _solve_net_to_gross(target_net: Decimal, params: Dict[str, Any]) -> Tuple[Decimal, Decimal]:
    lo, hi = Decimal("0"), max(Decimal("1"), target_net * 3)
    for _ in range(60):
        mid = (lo + hi) / 2
        withholding = Decimal(compute_withholding(mid, params.get("period", "weekly"), params.get("residency", "resident"), params)) / 100
        net = mid - withholding
        if net > target_net:
            hi = mid
        else:
            lo = mid
    gross = (lo + hi) / 2
    withholding = Decimal(compute_withholding(gross, params.get("period", "weekly"), params.get("residency", "resident"), params)) / 100
    return gross, withholding


def compute(event: Dict[str, Any], rules: Dict[str, Any] | None = None) -> Dict[str, Any]:
    pw = event.get("payg_w", {}) or {}
    method = (pw.get("method") or "table_ato").lower()
    period = (pw.get("period") or "weekly").lower()
    residency = (pw.get("residency") or "resident").lower()
    params = {
        "period": period,
        "residency": residency,
        "tax_free_threshold": bool(pw.get("tax_free_threshold", True)),
        "stsl": bool(pw.get("stsl", False)),
    }

    gross = _to_decimal(pw.get("gross", 0) or 0)
    explain = [
        f"method={method} period={period} residency={residency} TFT={params['tax_free_threshold']} STSL={params['stsl']}"
    ]

    if method == "percent_simple":
        withholding = _percent_simple(gross, _to_decimal(pw.get("percent", 0)))
    elif method == "flat_plus_percent":
        withholding = _flat_plus_percent(gross, _to_decimal(pw.get("percent", 0)), _to_decimal(pw.get("extra", 0)))
    elif method == "bonus_marginal":
        withholding = _bonus_marginal(_to_decimal(pw.get("regular_gross", gross)), _to_decimal(pw.get("bonus", 0)), params)
    elif method == "net_to_gross" and pw.get("target_net") is not None:
        target_net = _to_decimal(pw.get("target_net"))
        gross, withholding = _solve_net_to_gross(target_net, params)
        net = gross - withholding
        return {
            "method": method,
            "gross": float(_round(gross)),
            "withholding": float(_round(withholding)),
            "net": float(_round(net)),
            "explain": explain + [f"solved net_to_gross target_net={target_net}"]
        }
    else:
        cents = compute_withholding(gross, period, residency, params)
        withholding = Decimal(cents) / 100

    net = gross - withholding
    return {
        "method": method,
        "gross": float(_round(gross)),
        "withholding": float(_round(withholding)),
        "net": float(_round(net)),
        "explain": explain + [f"computed from gross={gross}"]
    }
