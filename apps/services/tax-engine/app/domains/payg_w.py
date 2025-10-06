from __future__ import annotations
from typing import Dict, Any, Tuple, List

def _round(amount: float, mode: str="HALF_UP") -> float:
    from decimal import Decimal, ROUND_HALF_UP, ROUND_HALF_EVEN, getcontext
    getcontext().prec = 28
    q = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP if mode=="HALF_UP" else ROUND_HALF_EVEN)
    return float(q)

def _extract_brackets(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not cfg:
        return []
    if "withholding" in cfg:
        withholding = cfg.get("withholding") or {}
        return list(withholding.get("brackets", []))
    if "brackets" in cfg:
        return list(cfg.get("brackets", []))
    formula = cfg.get("formula_progressive") or {}
    return list(formula.get("brackets", []))


def _bracket_withholding(gross: float, cfg: Dict[str, Any]) -> float:
    """Generic progressive bracket formula: tax = a*gross - b + fixed (per period)."""
    brs = _extract_brackets(cfg)
    for br in brs:
        up_to = br.get("up_to")
        if up_to is not None and gross > float(up_to):
            continue
        a = float(br.get("a", 0.0))
        b = float(br.get("b", 0.0))
        fixed = float(br.get("fixed", 0.0))
        return max(0.0, a * gross - b + fixed)
    return 0.0

def _percent_simple(gross: float, rate: float) -> float:
    return max(0.0, gross * rate)

def _flat_plus_percent(gross: float, rate: float, extra: float) -> float:
    return max(0.0, gross * rate + extra)

def _bonus_marginal(regular_gross: float, bonus: float, cfg: Dict[str, Any]) -> float:
    base = _bracket_withholding(regular_gross + bonus, cfg)
    only_base = _bracket_withholding(regular_gross, cfg)
    return max(0.0, base - only_base)

def _solve_net_to_gross(target_net: float, method_cfg: Tuple[str, Dict[str, Any]]) -> Tuple[float,float]:
    mname, params = method_cfg
    lo, hi = 0.0, max(1.0, target_net * 3.0)
    for _ in range(60):
        mid = (lo+hi)/2
        w = compute_withholding_for_gross(mid, mname, params)
        net = mid - w
        if net > target_net: hi = mid
        else: lo = mid
    gross = (lo+hi)/2
    w = compute_withholding_for_gross(gross, mname, params)
    return gross, w

def compute_withholding_for_gross(gross: float, method: str, params: Dict[str, Any]) -> float:
    if method == "formula_progressive":
        return _bracket_withholding(gross, params.get("formula_progressive", {}))
    if method == "percent_simple":
        return _percent_simple(gross, float(params.get("percent", 0.0)))
    if method == "flat_plus_percent":
        return _flat_plus_percent(gross, float(params.get("percent", 0.0)), float(params.get("extra", 0.0)))
    if method == "bonus_marginal":
        return _bonus_marginal(float(params.get("regular_gross", 0.0)), float(params.get("bonus", 0.0)), params.get("formula_progressive", {}))
    if method == "table_ato":
        # Placeholder: replace with exact ATO schedule logic per period & flags.
        return _bracket_withholding(gross, params.get("formula_progressive", {}))
    return 0.0

def compute(event: Dict[str, Any], rules: Dict[str, Any]) -> Dict[str, Any]:
    pw = event.get("payg_w", {}) or {}
    method = (pw.get("method") or "table_ato")
    period = (pw.get("period") or "weekly")
    requested_status = (pw.get("residency_status") or pw.get("status") or "resident").lower()
    params = {
        "period": period,
        "tax_free_threshold": bool(pw.get("tax_free_threshold", True)),
        "stsl": bool(pw.get("stsl", False)),
        "percent": float(pw.get("percent", 0.0)),
        "extra": float(pw.get("extra", 0.0)),
        "regular_gross": float(pw.get("regular_gross", 0.0)),
        "bonus": float(pw.get("bonus", 0.0)),
        "formula_progressive": {"brackets": _extract_brackets(rules)}
    }
    explain = [
        f"method={method} period={period} TFT={params['tax_free_threshold']} STSL={params['stsl']} status={requested_status}"
    ]
    gross = float(pw.get("gross", 0.0) or 0.0)
    target_net = pw.get("target_net")

    if method == "net_to_gross" and target_net is not None:
        gross, w = _solve_net_to_gross(float(target_net), ("formula_progressive", params))
        net = gross - w
        return {"method": method, "gross": _round(gross), "withholding": _round(w), "net": _round(net), "explain": explain + [f"solved net_to_gross target_net={target_net}"]}
    else:
        w = compute_withholding_for_gross(gross, method, params)
        net = gross - w
        return {"method": method, "gross": _round(gross), "withholding": _round(w), "net": _round(net), "explain": explain + [f"computed from gross={gross}"]}
