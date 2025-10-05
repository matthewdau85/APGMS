from __future__ import annotations
from typing import Dict, Any, Tuple

from ..rules.loader import (
    load_payg_rules_index,
    resolve_financial_year,
)

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
        return _table_ato(gross, params)
    return 0.0

def _resolve_basis(params: Dict[str, Any], schedule: Dict[str, Any]) -> str:
    basis = params.get("calculation_basis")
    if basis and basis in schedule:
        return basis
    resident = bool(params.get("resident", True))
    tft = bool(params.get("tax_free_threshold", True))
    if not resident:
        candidate = "foreign_resident"
    else:
        candidate = "resident_tft" if tft else "resident_no_tft"
    return candidate if candidate in schedule else next(iter(schedule))


def _annual_tax_from_brackets(income: float, brackets: Tuple[Dict[str, Any], ...]) -> float:
    for bracket in sorted(brackets, key=lambda b: float(b.get("threshold", 0.0)), reverse=True):
        threshold = float(bracket.get("threshold", 0.0))
        if income >= threshold:
            base = float(bracket.get("base", 0.0))
            rate = float(bracket.get("rate", 0.0))
            return base + (income - threshold) * rate
    return 0.0


def _lito_offset(income: float, cfg: Dict[str, Any]) -> float:
    if not cfg:
        return 0.0
    full_amount = float(cfg.get("full_amount", 0.0))
    if income <= float(cfg.get("full_threshold", 0.0)):
        return full_amount
    phase1_end = float(cfg.get("phase1_end", 0.0))
    phase1_taper = float(cfg.get("phase1_taper", 0.0))
    if income <= phase1_end and phase1_taper:
        return max(0.0, full_amount - (income - float(cfg.get("full_threshold", 0.0))) * phase1_taper)
    phase2_end = float(cfg.get("phase2_end", 0.0))
    phase2_taper = float(cfg.get("phase2_taper", 0.0))
    if income <= phase2_end and phase2_taper:
        phase1_amount = max(0.0, full_amount - (phase1_end - float(cfg.get("full_threshold", 0.0))) * phase1_taper)
        return max(0.0, phase1_amount - (income - phase1_end) * phase2_taper)
    return 0.0


def _medicare_levy(income: float, cfg: Dict[str, Any]) -> float:
    if not cfg:
        return 0.0
    rate = float(cfg.get("rate", 0.0))
    low = float(cfg.get("low_threshold", 0.0))
    phase_end = float(cfg.get("phase_in_end", 0.0))
    if rate <= 0 or income <= low:
        return 0.0
    if income < phase_end:
        phase_rate = float(cfg.get("phase_in_rate", 0.0)) or rate / 2
        return (income - low) * phase_rate
    return income * rate


def _stsl_withholding(income: float, cfg) -> float:
    if not cfg:
        return 0.0
    applicable = 0.0
    for bracket in cfg:
        threshold = float(bracket.get("threshold", 0.0))
        if income >= threshold:
            applicable = float(bracket.get("rate", 0.0))
        else:
            break
    return income * applicable


def _table_ato(gross: float, params: Dict[str, Any]) -> float:
    rules_index = params.get("rules_index") or load_payg_rules_index()
    financial_year = resolve_financial_year(
        params.get("financial_year"),
        params.get("payment_date"),
    )
    schedule = rules_index.get(financial_year)
    if not schedule:
        if not rules_index:
            return 0.0
        financial_year, schedule = next(iter(rules_index.items()))
    bases = schedule.get("bases", {})
    basis_key = _resolve_basis(params, bases)
    basis_cfg = bases.get(basis_key, {})
    period = params.get("period") or "weekly"
    multiplier = float(schedule.get("period_multipliers", {}).get(period, 52))
    annual_income = gross * multiplier
    annual_tax = _annual_tax_from_brackets(annual_income, tuple(basis_cfg.get("brackets", [])))
    if basis_cfg.get("apply_lito"):
        annual_tax -= _lito_offset(annual_income, schedule.get("lito", {}))
    if basis_cfg.get("apply_medicare"):
        annual_tax += _medicare_levy(annual_income, schedule.get("medicare_levy", {}))
    if params.get("stsl"):
        annual_tax += _stsl_withholding(annual_income, schedule.get("stsl", []))
    annual_tax = max(0.0, annual_tax)
    withholding = annual_tax / multiplier
    return max(0.0, withholding)


def compute(event: Dict[str, Any], rules: Dict[str, Any] | None = None) -> Dict[str, Any]:
    pw = event.get("payg_w", {}) or {}
    method = (pw.get("method") or "table_ato")
    period = (pw.get("period") or "weekly")
    rules_index = rules or load_payg_rules_index()
    if isinstance(rules_index, dict) and rules_index.get("financial_year"):
        fy = rules_index["financial_year"]
        rules_index = {fy: rules_index}
    params = {
        "period": period,
        "tax_free_threshold": bool(pw.get("tax_free_threshold", True)),
        "stsl": bool(pw.get("stsl", False)),
        "resident": bool(pw.get("resident", True)),
        "calculation_basis": pw.get("calculation_basis"),
        "financial_year": pw.get("financial_year"),
        "payment_date": pw.get("payment_date"),
        "percent": float(pw.get("percent", 0.0)),
        "extra": float(pw.get("extra", 0.0)),
        "regular_gross": float(pw.get("regular_gross", 0.0)),
        "bonus": float(pw.get("bonus", 0.0)),
        "rules_index": rules_index,
        "formula_progressive": (next(iter(rules_index.values())).get("formula_progressive") if rules_index else {}),
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
