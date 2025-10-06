from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Iterable, Mapping

AtoRoundingMode = str

_PERIOD_KEY = "periods"
_SCALE_KEY = "scales"
_STSL_KEY = "stsl"


def _ensure_decimal(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _ato_round(value: Decimal, mode: AtoRoundingMode) -> Decimal:
    quantise = Decimal("1") if mode == "NEAREST_DOLLAR" else Decimal("0.01")
    return value.quantize(quantise, rounding=ROUND_HALF_UP)


def _annual_tax(income: Decimal, brackets: Iterable[Mapping[str, Any]]) -> Decimal:
    if income <= 0:
        return Decimal("0")
    tax = Decimal("0")
    for bracket in brackets:
        lower = _ensure_decimal(bracket.get("threshold", 0))
        upper = bracket.get("limit")
        rate = _ensure_decimal(bracket.get("rate", 0))
        if income <= lower:
            break
        effective_upper = _ensure_decimal(upper) if upper is not None else income
        taxable = min(income, effective_upper) - lower
        if taxable <= 0:
            continue
        tax += taxable * rate
        if income <= effective_upper:
            break
    return tax


def _stsl_rate(income: Decimal, stsl_cfg: Mapping[str, Any]) -> Decimal:
    rates = stsl_cfg.get("rates", [])
    applied = Decimal("0")
    for row in sorted(rates, key=lambda r: r.get("threshold", 0)):
        threshold = _ensure_decimal(row.get("threshold", 0))
        if income >= threshold:
            applied = _ensure_decimal(row.get("rate", 0))
        else:
            break
    cap = stsl_cfg.get("cap_rate")
    if cap is not None:
        applied = min(applied, _ensure_decimal(cap))
    return applied


def payg_withholding(
    gross: float | Decimal,
    *,
    period: str,
    tax_free_threshold: bool,
    stsl: bool,
    rules: Mapping[str, Any],
) -> Decimal:
    """Compute PAYG withholding for a pay period using published schedules."""
    gross_dec = _ensure_decimal(gross)
    if gross_dec <= 0:
        return Decimal("0")

    periods_cfg = rules.get(_PERIOD_KEY, {})
    if period not in periods_cfg:
        raise ValueError(f"Unknown period '{period}'")
    period_cfg = periods_cfg[period]
    per_year = _ensure_decimal(period_cfg.get("per_year", 52))
    rounding_mode: AtoRoundingMode = period_cfg.get("rounding") or rules.get("rounding", {}).get("mode", "NEAREST_DOLLAR")

    scales = rules.get(_SCALE_KEY, {})
    scale_key = "tax_free_threshold" if tax_free_threshold else "no_tax_free_threshold"
    brackets = scales.get(scale_key)
    if not brackets:
        raise ValueError(f"Rules missing scale '{scale_key}'")

    annual_income = gross_dec * per_year
    annual_tax = _annual_tax(annual_income, brackets)

    if stsl:
        stsl_cfg = rules.get(_STSL_KEY, {})
        rate = _stsl_rate(annual_income, stsl_cfg)
        annual_tax += annual_income * rate

    per_period = annual_tax / per_year
    per_period = _ato_round(per_period, rounding_mode)
    if per_period < 0:
        return Decimal("0")
    return per_period


def _gst_round(value: Decimal, mode: AtoRoundingMode) -> Decimal:
    return _ato_round(value, mode)


def gst_labels(lines: Iterable[Mapping[str, Any]], rules: Mapping[str, Any]) -> Dict[str, Decimal]:
    """Aggregate GST amounts into BAS labels using supplied rules."""
    rounding_mode: AtoRoundingMode = rules.get("rounding", {}).get("mode", "NEAREST_DOLLAR")
    codes = rules.get("codes", {})
    sales_labels = rules.get("labels", {}).get("sales", {})
    purchase_labels = rules.get("labels", {}).get("purchases", {})

    totals: Dict[str, Decimal] = {
        label: Decimal("0")
        for label in set(list(sales_labels.keys()) + list(purchase_labels.keys()))
    }

    for line in lines:
        amount = _ensure_decimal(line.get("amount", 0))
        if amount == 0:
            continue
        tax_code = str(line.get("tax_code", "")).upper()
        kind = (line.get("kind") or "sale").lower()
        capital = bool(line.get("capital", False))
        gst_rate = _ensure_decimal(codes.get(tax_code, {}).get("rate", 0))

        if kind == "sale":
            for label, cfg in sales_labels.items():
                if cfg.get("type") == "tax":
                    continue
                if tax_code in cfg.get("codes", []):
                    totals[label] = totals.get(label, Decimal("0")) + amount
            tax_label = sales_labels.get("1A")
            if gst_rate > 0 and tax_label and tax_code in tax_label.get("codes", []):
                tax_amount = (amount * gst_rate) / (Decimal("1") + gst_rate)
                totals["1A"] = totals.get("1A", Decimal("0")) + tax_amount
        else:
            if capital and "G10" in purchase_labels:
                totals["G10"] = totals.get("G10", Decimal("0")) + amount
            elif "G11" in purchase_labels:
                totals["G11"] = totals.get("G11", Decimal("0")) + amount
            tax_label = purchase_labels.get("1B")
            if gst_rate > 0 and tax_label and tax_code in tax_label.get("codes", []):
                tax_amount = (amount * gst_rate) / (Decimal("1") + gst_rate)
                totals["1B"] = totals.get("1B", Decimal("0")) + tax_amount

    for label in list(totals.keys()):
        totals[label] = _gst_round(totals[label], rounding_mode)

    return totals


__all__ = ["payg_withholding", "gst_labels"]
