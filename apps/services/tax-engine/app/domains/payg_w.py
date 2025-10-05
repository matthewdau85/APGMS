from __future__ import annotations
from typing import Dict, Any, Tuple, Optional

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
        return _compute_table_withholding(gross, params)
    return 0.0


def _progressive_tax(annual: float, brackets: Tuple[Dict[str, Any], ...]) -> float:
    if annual <= 0:
        return 0.0
    applicable: Optional[Dict[str, Any]] = None
    for bracket in brackets:
        if annual >= float(bracket.get("threshold", 0.0)):
            applicable = bracket
        else:
            break
    if not applicable:
        return 0.0
    threshold = float(applicable.get("threshold", 0.0))
    rate = float(applicable.get("rate", 0.0))
    base = float(applicable.get("base", 0.0))
    return max(0.0, base + (annual - threshold) * rate)


def _lito_amount(annual: float, cfg: Dict[str, Any]) -> float:
    if annual <= 0:
        return 0.0
    full_amount = float(cfg.get("full_amount", 0.0))
    full_threshold = float(cfg.get("full_threshold", 0.0))
    if full_amount <= 0:
        return 0.0
    if annual <= full_threshold:
        return full_amount
    phase1 = cfg.get("phase_out_1", {})
    start1 = float(phase1.get("start", full_threshold))
    end1 = float(phase1.get("end", full_threshold))
    rate1 = float(phase1.get("rate", 0.0))
    if rate1 > 0 and annual <= end1:
        return max(0.0, full_amount - (annual - start1) * rate1)
    phase2 = cfg.get("phase_out_2", {})
    start2 = float(phase2.get("start", end1))
    end2 = float(phase2.get("end", end1))
    rate2 = float(phase2.get("rate", 0.0))
    base2 = float(phase2.get("base", full_amount))
    if rate2 > 0 and annual <= end2:
        return max(0.0, base2 - (annual - start2) * rate2)
    return 0.0


def _medicare_levy(annual: float, variation: str, cfg: Dict[str, Any]) -> float:
    if annual <= 0:
        return 0.0
    variation_key = variation or "standard"
    var_cfg = cfg.get(variation_key) or cfg.get("standard") or {}
    rate = float(var_cfg.get("rate", 0.0))
    if rate <= 0:
        return 0.0
    lower = float(var_cfg.get("lower_threshold", 0.0))
    upper = float(var_cfg.get("upper_threshold", lower))
    shade_rate = float(var_cfg.get("shade_rate", 0.0))
    if annual <= lower:
        return 0.0
    if shade_rate > 0 and upper > lower and annual <= upper:
        return max(0.0, (annual - lower) * shade_rate)
    credit = var_cfg.get("credit")
    if credit is None and shade_rate > 0 and upper > lower:
        credit = rate * upper - shade_rate * (upper - lower)
    credit = float(credit or 0.0)
    return max(0.0, rate * annual - credit)


def _stsl_withholding(annual: float, cfg: Tuple[Dict[str, Any], ...]) -> float:
    if annual <= 0 or not cfg:
        return 0.0
    rate = 0.0
    for bracket in cfg:
        threshold = float(bracket.get("threshold", 0.0))
        if annual >= threshold:
            rate = float(bracket.get("rate", rate))
        else:
            break
    return max(0.0, annual * rate)


def _compute_table_withholding(gross: float, params: Dict[str, Any]) -> float:
    rules = params.get("rules") or {}
    period = params.get("period") or "weekly"
    periods_cfg = rules.get("periods", {})
    period_cfg = periods_cfg.get(period)
    if not period_cfg:
        raise ValueError(f"Unsupported PAYG-W period '{period}'")
    multiplier = float(period_cfg.get("annual_multiplier", 52.0))
    rounding_mode = period_cfg.get("rounding", "HALF_UP")
    annual_gross = max(0.0, gross) * multiplier

    income_brackets = tuple(rules.get("income_tax", {}).get("resident", []))
    annual_tax = _progressive_tax(annual_gross, income_brackets)

    if params.get("tax_free_threshold", True):
        lito_cfg = rules.get("lito", {})
        annual_tax = max(0.0, annual_tax - _lito_amount(annual_gross, lito_cfg))
    else:
        annual_tax = max(0.0, annual_tax)
        annual_tax += float(rules.get("tax_free_threshold_forfeit", 0.0))

    medicare_cfg = rules.get("medicare_levy", {})
    medicare_variation = (params.get("medicare_variation") or "standard").lower()
    medicare_annual = _medicare_levy(annual_gross, medicare_variation, medicare_cfg)

    if params.get("stsl", False):
        stsl_annual = _stsl_withholding(annual_gross, tuple(rules.get("stsl", [])))
    else:
        stsl_annual = 0.0

    income_component = _round((annual_tax / multiplier) if multiplier else annual_tax, rounding_mode)
    medicare_component = _round((medicare_annual / multiplier) if multiplier else medicare_annual, rounding_mode) if medicare_annual else 0.0
    stsl_component = _round((stsl_annual / multiplier) if multiplier else stsl_annual, rounding_mode) if stsl_annual else 0.0

    withholding = income_component + medicare_component + stsl_component
    return max(0.0, withholding)

def compute(event: Dict[str, Any], rules: Dict[str, Any]) -> Dict[str, Any]:
    pw = event.get("payg_w", {}) or {}
    method = (pw.get("method") or "table_ato")
    period = (pw.get("period") or "weekly")
    params = {
        "period": period,
        "tax_free_threshold": bool(pw.get("tax_free_threshold", True)),
        "stsl": bool(pw.get("stsl", False)),
        "medicare_variation": (pw.get("medicare_variation") or "standard"),
        "percent": float(pw.get("percent", 0.0)),
        "extra": float(pw.get("extra", 0.0)),
        "regular_gross": float(pw.get("regular_gross", 0.0)),
        "bonus": float(pw.get("bonus", 0.0)),
        "formula_progressive": (rules.get("formula_progressive") or {}),
        "rules": rules,
    }
    explain = [f"method={method} period={period} TFT={params['tax_free_threshold']} STSL={params['stsl']}"]
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
