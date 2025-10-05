from __future__ import annotations
from typing import Dict, Any, Tuple, Sequence

def _round(amount: float, mode: str="HALF_UP") -> float:
    from decimal import Decimal, ROUND_HALF_UP, ROUND_HALF_EVEN, getcontext
    getcontext().prec = 28
    q = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP if mode=="HALF_UP" else ROUND_HALF_EVEN)
    return float(q)

def _bracket_withholding(gross: float, cfg: Dict[str, Any]) -> float:
    """Generic progressive bracket formula: tax = a*gross - b + fixed (per period)."""
    brs = cfg.get("brackets", [])
    for br in brs:
        if gross <= float(br.get("up_to", 9e9)):
            a = float(br.get("a", 0.0)); b = float(br.get("b", 0.0)); fixed = float(br.get("fixed", 0.0))
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

def _progressive_annual_tax(income: float, brackets: Sequence[Dict[str, Any]]) -> float:
    tax = 0.0
    for br in brackets:
        min_amt = float(br.get("min", 0.0))
        max_amt = float(br.get("max", float("inf")))
        rate = float(br.get("rate", 0.0))
        base = float(br.get("base", 0.0))
        if income <= max_amt:
            tax = base + max(0.0, income - min_amt) * rate
            return max(tax, 0.0)
    if brackets:
        last = brackets[-1]
        min_amt = float(last.get("min", 0.0))
        rate = float(last.get("rate", 0.0))
        base = float(last.get("base", 0.0))
        tax = base + max(0.0, income - min_amt) * rate
    return max(tax, 0.0)

def _lito_amount(income: float, tiers: Sequence[Dict[str, Any]]) -> float:
    for tier in tiers:
        min_amt = float(tier.get("min", 0.0))
        max_amt = float(tier.get("max", float("inf")))
        base = float(tier.get("base", 0.0))
        taper = float(tier.get("taper", 0.0))
        if income <= max_amt:
            if taper <= 0:
                return base
            reduction = max(0.0, income - min_amt) * taper
            return max(0.0, base - reduction)
    return 0.0

def _medicare_levy(income: float, cfg: Dict[str, Any]) -> float:
    lower = float(cfg.get("lower_threshold", 0.0))
    upper = float(cfg.get("upper_threshold", lower))
    phase_in = float(cfg.get("phase_in_rate", 0.0))
    rate = float(cfg.get("levy_rate", 0.0))
    if income <= lower:
        return 0.0
    if income <= upper:
        return max(0.0, (income - lower) * phase_in)
    return max(0.0, income * rate)

def _stsl_annual(income: float, tiers: Sequence[Dict[str, Any]]) -> float:
    rate = 0.0
    for tier in tiers:
        if income >= float(tier.get("min", 0.0)):
            rate = float(tier.get("rate", 0.0))
        else:
            break
    return max(0.0, income * rate)

def _table_ato_withholding(gross: float, params: Dict[str, Any]) -> float:
    rules = params.get("tables", {})
    periods = rules.get("periods", {})
    period = params.get("period", "weekly")
    periods_per_year = float(periods.get(period, {}).get("periods_per_year", 52))
    annual_income = gross * periods_per_year
    tax_scales = rules.get("tax_scales", {})
    brackets_key = "tax_free_threshold" if params.get("tax_free_threshold", True) else "no_tax_free_threshold"
    brackets = tax_scales.get(brackets_key, [])
    base_tax = _progressive_annual_tax(annual_income, brackets)
    lito = _lito_amount(annual_income, rules.get("lito", [])) if params.get("tax_free_threshold", True) else 0.0
    medicare = _medicare_levy(annual_income, rules.get("medicare", {}))
    stsl = _stsl_annual(annual_income, rules.get("stsl", [])) if params.get("stsl") else 0.0
    annual_withholding = max(0.0, base_tax - lito + medicare + stsl)
    return annual_withholding / periods_per_year

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
        return _table_ato_withholding(gross, params)
    return 0.0

def compute(event: Dict[str, Any], rules: Dict[str, Any]) -> Dict[str, Any]:
    pw = event.get("payg_w", {}) or {}
    method = (pw.get("method") or "table_ato")
    period = (pw.get("period") or "weekly")
    table_params = {
        "periods": rules.get("periods", {}),
        "tax_scales": rules.get("tax_scales", {}),
        "lito": rules.get("lito", []),
        "medicare": rules.get("medicare", {}),
        "stsl": rules.get("stsl", []),
    }
    params = {
        "period": period,
        "tax_free_threshold": bool(pw.get("tax_free_threshold", True)),
        "stsl": bool(pw.get("stsl", False)),
        "percent": float(pw.get("percent", 0.0)),
        "extra": float(pw.get("extra", 0.0)),
        "regular_gross": float(pw.get("regular_gross", 0.0)),
        "bonus": float(pw.get("bonus", 0.0)),
        "formula_progressive": (rules.get("formula_progressive") or {}),
        "tables": table_params,
    }
    explain = [f"method={method} period={period} TFT={params['tax_free_threshold']} STSL={params['stsl']}"]
    gross = float(pw.get("gross", 0.0) or 0.0)
    target_net = pw.get("target_net")

    if method == "net_to_gross" and target_net is not None:
        gross, w = _solve_net_to_gross(float(target_net), ("table_ato", params))
        net = gross - w
        return {"method": method, "gross": _round(gross), "withholding": _round(w), "net": _round(net), "explain": explain + [f"solved net_to_gross target_net={target_net}"]}
    else:
        w = compute_withholding_for_gross(gross, method, params)
        net = gross - w
        return {"method": method, "gross": _round(gross), "withholding": _round(w), "net": _round(net), "explain": explain + [f"computed from gross={gross}"]}
