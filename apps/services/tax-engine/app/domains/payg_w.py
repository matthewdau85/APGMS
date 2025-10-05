from __future__ import annotations
from typing import Dict, Any, Tuple, List, Optional

def _round(amount: float, mode: str = "HALF_UP") -> float:
    from decimal import Decimal, ROUND_HALF_UP, ROUND_HALF_EVEN, getcontext
    getcontext().prec = 28
    q = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP if mode == "HALF_UP" else ROUND_HALF_EVEN)
    return float(q)

def _bracket_withholding(gross: float, cfg: Dict[str, Any]) -> float:
    """Generic progressive bracket formula: tax = a*gross - b + fixed (per period)."""
    for br in cfg.get("brackets", []) or []:
        if gross <= float(br.get("up_to", 9e9)):
            a = float(br.get("a", 0.0))
            b = float(br.get("b", 0.0))
            fixed = float(br.get("fixed", 0.0))
            return max(0.0, a * gross - b + fixed)
    return 0.0

def _period_cfg(rules: Dict[str, Any], period: str) -> Dict[str, Any]:
    periods = rules.get("periods", {}) or {}
    return periods.get(period, periods.get("weekly", {})) or {}

def _annual_tax(income: float, brackets: List[Dict[str, Any]]) -> float:
    tax = 0.0
    for br in sorted(brackets, key=lambda b: float(b.get("threshold", 0.0))):
        threshold = float(br.get("threshold", 0.0))
        if income >= threshold:
            base = float(br.get("base", 0.0))
            rate = float(br.get("rate", 0.0))
            tax = base + rate * (income - threshold)
        else:
            break
    return max(0.0, tax)

def _lito_offset(income: float, cfg: List[Dict[str, Any]]) -> float:
    for seg in cfg or []:
        if income <= float(seg.get("up_to", 9e9)):
            a = float(seg.get("a", 0.0))
            b = float(seg.get("b", 0.0))
            return max(0.0, a * income + b)
    return 0.0

def _stsl_rate(income: float, thresholds: List[Dict[str, Any]]) -> float:
    for band in thresholds or []:
        lo = float(band.get("min", 0.0))
        hi = float(band.get("max", 9e9))
        if income >= lo and income <= hi:
            return float(band.get("rate", 0.0))
    return 0.0

def _stsl_withholding(annual_income: float, factor: float, rules: Dict[str, Any]) -> Tuple[float, Optional[float]]:
    rate = _stsl_rate(annual_income, rules.get("thresholds", []) or [])
    if rate <= 0.0:
        return 0.0, None
    annual_amount = annual_income * rate
    period_amount = annual_amount / factor if factor else annual_amount
    return period_amount, rate

def _table_withholding(gross: float, params: Dict[str, Any], rules: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
    period = params.get("period", "weekly")
    period_cfg = _period_cfg(rules, period)
    factor = float(period_cfg.get("annual_factor", 52.0))
    annual_income = gross * factor

    tax_cfg = rules.get("annual_tax", {}) or {}
    brackets = tax_cfg.get("brackets", []) or []
    tax_before_offsets = _annual_tax(annual_income, brackets)

    tax_free_threshold = bool(params.get("tax_free_threshold", True))
    lito_cfg = rules.get("lito", []) or []
    lito_applied = _lito_offset(annual_income, lito_cfg) if tax_free_threshold else 0.0

    tax_after_offsets = max(0.0, tax_before_offsets - lito_applied)
    threshold_benefit = float(rules.get("tax_free_threshold_benefit", 0.0))
    if not tax_free_threshold and gross > 0:
        tax_after_offsets += threshold_benefit

    withholding = tax_after_offsets / factor if factor else tax_after_offsets

    components: Dict[str, float] = {"income_tax": max(0.0, withholding)}
    stsl_rate: Optional[float] = None
    if bool(params.get("stsl", False)):
        stsl_amount, stsl_rate = _stsl_withholding(annual_income, factor, rules.get("stsl", {}) or {})
        if stsl_amount:
            withholding += stsl_amount
            components["stsl"] = stsl_amount

    detail = {
        "components": components,
        "basis": "table_ato",
        "annual_income": annual_income,
        "factor": factor,
        "tax_before_offsets": tax_before_offsets,
        "lito_applied": lito_applied,
        "tax_free_threshold": tax_free_threshold,
        "threshold_benefit": threshold_benefit if not tax_free_threshold else 0.0,
        "stsl_rate": stsl_rate,
        "rounding": period_cfg.get("rounding", "HALF_UP"),
    }
    return max(0.0, withholding), detail

def _percent_simple(gross: float, rate: float) -> Tuple[float, Dict[str, Any]]:
    amount = max(0.0, gross * rate)
    return amount, {"components": {"income_tax": amount}, "basis": "percent_simple"}

def _flat_plus_percent(gross: float, rate: float, extra: float) -> Tuple[float, Dict[str, Any]]:
    amount = max(0.0, gross * rate + extra)
    return amount, {"components": {"income_tax": amount}, "basis": "flat_plus_percent"}

def _bonus_marginal(regular_gross: float, bonus: float, params: Dict[str, Any], rules: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
    params_copy = dict(params)
    params_copy["bonus"] = bonus
    total, total_detail = _table_withholding(regular_gross + bonus, params_copy, rules)
    base, base_detail = _table_withholding(regular_gross, params_copy, rules)
    withholding = max(0.0, total - base)
    detail = {
        "components": {"income_tax": withholding},
        "basis": "bonus_marginal",
        "bonus": bonus,
        "regular_gross": regular_gross,
        "base_withholding": base,
        "total_withholding": total,
        "base_components": base_detail.get("components", {}),
        "total_components": total_detail.get("components", {}),
        "rounding": total_detail.get("rounding"),
    }
    return withholding, detail

def _solve_net_to_gross(target_net: float, method_cfg: Tuple[str, Dict[str, Any]], rules: Dict[str, Any]) -> Tuple[float, float, Dict[str, Any]]:
    mname, params = method_cfg
    lo, hi = 0.0, max(1.0, target_net * 3.0)
    for _ in range(60):
        mid = (lo + hi) / 2
        w, _ = compute_withholding_for_gross(mid, mname, params, rules)
        net = mid - w
        if net > target_net:
            hi = mid
        else:
            lo = mid
    gross = (lo + hi) / 2
    w, detail = compute_withholding_for_gross(gross, mname, params, rules)
    return gross, w, detail

def compute_withholding_for_gross(gross: float, method: str, params: Dict[str, Any], rules: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
    if method == "formula_progressive":
        amount = _bracket_withholding(gross, params.get("formula_progressive", {}))
        return amount, {"components": {"income_tax": amount}, "basis": "formula_progressive", "rounding": "HALF_UP"}
    if method == "percent_simple":
        return _percent_simple(gross, float(params.get("percent", 0.0)))
    if method == "flat_plus_percent":
        return _flat_plus_percent(gross, float(params.get("percent", 0.0)), float(params.get("extra", 0.0)))
    if method == "bonus_marginal":
        return _bonus_marginal(float(params.get("regular_gross", 0.0)), float(params.get("bonus", 0.0)), params, rules)
    if method == "table_ato":
        return _table_withholding(gross, params, rules)
    if method == "net_to_gross":  # used via _solve_net_to_gross wrapper
        return _table_withholding(gross, params, rules)
    return 0.0, {"components": {"income_tax": 0.0}, "basis": method, "rounding": "HALF_UP"}

def _lookup_samples(rules: Dict[str, Any], period: str, params: Dict[str, Any], gross: float) -> List[Dict[str, Any]]:
    samples = (rules.get("ato_reference", {}) or {}).get("paygw_withholding", [])
    matches: List[Dict[str, Any]] = []
    for sample in samples:
        if sample.get("period") != period:
            continue
        if bool(sample.get("tax_free_threshold", True)) != params.get("tax_free_threshold", True):
            continue
        if bool(sample.get("stsl", False)) != params.get("stsl", False):
            continue
        if abs(float(sample.get("gross", 0.0)) - gross) > 1e-6:
            continue
        matches.append(sample)
    return matches

def compute(event: Dict[str, Any], rules: Dict[str, Any]) -> Dict[str, Any]:
    pw = event.get("payg_w", {}) or {}
    method = (pw.get("method") or "table_ato")
    period = (pw.get("period") or "weekly")
    params = {
        "period": period,
        "tax_free_threshold": bool(pw.get("tax_free_threshold", True)),
        "stsl": bool(pw.get("stsl", False)),
        "percent": float(pw.get("percent", 0.0)),
        "extra": float(pw.get("extra", 0.0)),
        "regular_gross": float(pw.get("regular_gross", pw.get("gross", 0.0) or 0.0)),
        "bonus": float(pw.get("bonus", 0.0)),
        "formula_progressive": (rules.get("formula_progressive") or {}),
    }
    explain = [f"method={method} period={period} TFT={params['tax_free_threshold']} STSL={params['stsl']}"]
    gross = float(pw.get("gross", 0.0) or 0.0)
    target_net = pw.get("target_net")

    detail: Dict[str, Any]
    if method == "net_to_gross" and target_net is not None:
        gross, withholding, detail = _solve_net_to_gross(float(target_net), ("table_ato", params), rules)
        explain.append(f"solved net_to_gross target_net={target_net}")
    else:
        withholding, detail = compute_withholding_for_gross(gross, method, params, rules)
        explain.append(f"computed from gross={gross}")

    net = gross - withholding
    rounding_mode = detail.get("rounding") or (_period_cfg(rules, period).get("rounding") or "HALF_UP")

    result = {
        "method": method,
        "period": period,
        "gross": _round(gross, rounding_mode),
        "withholding": _round(withholding, rounding_mode),
        "net": _round(net, rounding_mode),
        "components": {k: _round(v, rounding_mode) for k, v in detail.get("components", {}).items()},
        "detail": detail,
        "explain": explain,
    }

    discrepancies: List[Dict[str, Any]] = []
    for sample in _lookup_samples(rules, period, params, gross):
        expected_key = "withholding_including_stsl" if params.get("stsl") else "withholding"
        expected = float(sample.get(expected_key, sample.get("withholding", 0.0)))
        delta = _round(result["withholding"] - expected, rounding_mode)
        if abs(delta) > 0.01:
            discrepancies.append({
                "gross": sample.get("gross"),
                "expected": expected,
                "actual": result["withholding"],
                "delta": delta,
                "source": sample.get("source"),
            })
    if discrepancies:
        result["discrepancies"] = discrepancies

    return result
