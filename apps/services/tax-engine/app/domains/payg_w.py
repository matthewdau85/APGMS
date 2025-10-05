from __future__ import annotations
from typing import Dict, Any, Tuple, List

def _round(amount: float, mode: str = "HALF_UP") -> float:
    from decimal import Decimal, ROUND_HALF_UP, ROUND_HALF_EVEN, getcontext
    getcontext().prec = 28
    quant = Decimal("0.01")
    rounding = ROUND_HALF_UP if mode == "HALF_UP" else ROUND_HALF_EVEN
    return float(Decimal(str(amount)).quantize(quant, rounding=rounding))

def _annual_factor(period: str, rules: Dict[str, Any]) -> float:
    factors = rules.get("annual_factors", {})
    if period not in factors:
        raise ValueError(f"Unsupported PAYG-W period '{period}'")
    return float(factors[period])

def _annual_tax(income: float, brackets: List[Dict[str, Any]]) -> float:
    if income <= 0:
        return 0.0
    tax = 0.0
    for bracket in sorted(brackets, key=lambda b: float(b.get("threshold", 0.0)), reverse=True):
        threshold = float(bracket.get("threshold", 0.0))
        if income >= threshold:
            base = float(bracket.get("base", 0.0))
            rate = float(bracket.get("rate", 0.0))
            tax = base + (income - threshold) * rate
            break
    return max(0.0, tax)

def _lito(income: float, offsets_cfg: Dict[str, Any]) -> float:
    lito_cfg = offsets_cfg.get("lito") if offsets_cfg else None
    if not lito_cfg:
        return 0.0
    max_offset = float(lito_cfg.get("max", 0.0))
    phase_one = lito_cfg.get("phase_one", {})
    phase_two = lito_cfg.get("phase_two", {})
    threshold_one = float(phase_one.get("threshold", 0.0))
    rate_one = float(phase_one.get("rate", 0.0))
    threshold_two = float(phase_two.get("threshold", threshold_one))
    rate_two = float(phase_two.get("rate", 0.0))
    end_two = float(phase_two.get("end", threshold_two))

    if income <= threshold_one:
        return max_offset
    if income <= threshold_two:
        return max(0.0, max_offset - (income - threshold_one) * rate_one)

    offset_after_phase_one = max(0.0, max_offset - (threshold_two - threshold_one) * rate_one)
    if income <= end_two:
        return max(0.0, offset_after_phase_one - (income - threshold_two) * rate_two)
    return 0.0

def _medicare_levy(income: float, medicare_cfg: Dict[str, Any]) -> float:
    default_cfg = medicare_cfg.get("default") if medicare_cfg else None
    if not default_cfg or income <= 0:
        return 0.0
    lower = float(default_cfg.get("lower_threshold", 0.0))
    phase_rate = float(default_cfg.get("phase_in_rate", 0.0))
    rate = float(default_cfg.get("rate", 0.0))
    if income <= lower:
        return 0.0
    levy_full = income * rate
    levy_phase = max(0.0, (income - lower) * phase_rate)
    return min(levy_full, levy_phase)

def _stsl_amount(income: float, stsl_cfg: Dict[str, Any]) -> float:
    thresholds = stsl_cfg.get("thresholds", []) if stsl_cfg else []
    rate = 0.0
    for band in sorted(thresholds, key=lambda b: float(b.get("threshold", 0.0))):
        threshold = float(band.get("threshold", 0.0))
        if income >= threshold:
            rate = float(band.get("rate", rate))
        else:
            break
    return income * rate

def _table_components(gross: float, params: Dict[str, Any]) -> Dict[str, float]:
    rules = params.get("table_rules", {})
    period = params.get("period", "weekly")
    tax_free_threshold = bool(params.get("tax_free_threshold", True))
    stsl_flag = bool(params.get("stsl", False))

    factor = _annual_factor(period, rules)
    annual_income = gross * factor
    base_tax = _annual_tax(annual_income, rules.get("brackets", []))
    medicare = _medicare_levy(annual_income, rules.get("medicare", {}))
    offsets = rules.get("offsets", {}) if tax_free_threshold else {}
    lito_value = _lito(annual_income, offsets)
    stsl_value = _stsl_amount(annual_income, rules.get("stsl", {})) if stsl_flag else 0.0

    annual_withholding = base_tax + medicare - lito_value + stsl_value
    if annual_withholding < 0:
        annual_withholding = 0.0
    period_withholding = annual_withholding / factor if factor else 0.0

    return {
        "annual_income": annual_income,
        "base_tax": base_tax,
        "medicare": medicare,
        "lito": lito_value,
        "stsl": stsl_value,
        "annual_withholding": annual_withholding,
        "period_withholding": period_withholding,
    }

def _table_withholding(gross: float, params: Dict[str, Any]) -> float:
    components = _table_components(gross, params)
    return max(0.0, components["period_withholding"])

def _bonus_marginal(regular_gross: float, bonus: float, params: Dict[str, Any]) -> float:
    method_params = dict(params)
    method_params.pop("regular_gross", None)
    method_params.pop("bonus", None)
    base = _table_withholding(regular_gross + bonus, method_params)
    only_base = _table_withholding(regular_gross, method_params)
    return max(0.0, base - only_base)

def compute_withholding_for_gross(gross: float, method: str, params: Dict[str, Any]) -> float:
    if method == "table_ato" or method == "formula_progressive":
        return _table_withholding(gross, params)
    if method == "percent_simple":
        return max(0.0, gross * float(params.get("percent", 0.0)))
    if method == "flat_plus_percent":
        rate = float(params.get("percent", 0.0))
        extra = float(params.get("extra", 0.0))
        return max(0.0, gross * rate + extra)
    if method == "bonus_marginal":
        regular = float(params.get("regular_gross", 0.0))
        bonus = float(params.get("bonus", 0.0))
        return _bonus_marginal(regular, bonus, params)
    return 0.0

def _solve_net_to_gross(target_net: float, method: str, params: Dict[str, Any]) -> Tuple[float, float]:
    lo, hi = 0.0, max(1.0, target_net * 3.0)
    for _ in range(80):
        mid = (lo + hi) / 2
        withholding = compute_withholding_for_gross(mid, method, params)
        net = mid - withholding
        if net > target_net:
            hi = mid
        else:
            lo = mid
    gross = (lo + hi) / 2
    withholding = compute_withholding_for_gross(gross, method, params)
    return gross, withholding

def compute(event: Dict[str, Any], rules: Dict[str, Any]) -> Dict[str, Any]:
    pw = event.get("payg_w", {}) or {}
    method = pw.get("method") or "table_ato"
    period = pw.get("period") or "weekly"

    params: Dict[str, Any] = {
        "period": period,
        "tax_free_threshold": bool(pw.get("tax_free_threshold", True)),
        "stsl": bool(pw.get("stsl", False)),
        "percent": float(pw.get("percent", 0.0)),
        "extra": float(pw.get("extra", 0.0)),
        "regular_gross": float(pw.get("regular_gross", 0.0)),
        "bonus": float(pw.get("bonus", 0.0)),
        "table_rules": rules,
    }
    explain = [
        f"method={method}",
        f"period={period}",
        f"tax_free_threshold={params['tax_free_threshold']}",
        f"stsl={params['stsl']}"
    ]

    gross = float(pw.get("gross", 0.0) or 0.0)
    target_net = pw.get("target_net")

    if method == "net_to_gross" and target_net is not None:
        solver_method = pw.get("solver_method") or "table_ato"
        gross, withholding = _solve_net_to_gross(float(target_net), solver_method, params)
        net = gross - withholding
        explain.append(f"target_net={target_net}")
        return {
            "method": method,
            "gross": _round(gross, rules.get("rounding", "HALF_UP")),
            "withholding": _round(withholding, rules.get("rounding", "HALF_UP")),
            "net": _round(net, rules.get("rounding", "HALF_UP")),
            "explain": explain,
        }

    if method == "table_ato" or method == "formula_progressive":
        components = _table_components(gross, params)
        withholding = components["period_withholding"]
        net = gross - withholding
        explain.extend(
            [
                f"annual_income={_round(components['annual_income'], rules.get('rounding', 'HALF_UP'))}",
                f"base_tax={_round(components['base_tax'], rules.get('rounding', 'HALF_UP'))}",
                f"medicare={_round(components['medicare'], rules.get('rounding', 'HALF_UP'))}",
                f"lito={_round(components['lito'], rules.get('rounding', 'HALF_UP'))}",
                f"stsl={_round(components['stsl'], rules.get('rounding', 'HALF_UP'))}",
            ]
        )
        return {
            "method": method,
            "gross": _round(gross, rules.get("rounding", "HALF_UP")),
            "withholding": _round(withholding, rules.get("rounding", "HALF_UP")),
            "net": _round(net, rules.get("rounding", "HALF_UP")),
            "explain": explain,
        }

    withholding = compute_withholding_for_gross(gross, method, params)
    net = gross - withholding
    explain.append(f"gross_input={gross}")
    return {
        "method": method,
        "gross": _round(gross, rules.get("rounding", "HALF_UP")),
        "withholding": _round(withholding, rules.get("rounding", "HALF_UP")),
        "net": _round(net, rules.get("rounding", "HALF_UP")),
        "explain": explain,
    }
