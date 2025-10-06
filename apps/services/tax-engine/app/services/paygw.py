from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict

from ..rules import load_payg_rules


@dataclass(frozen=True)
class WithholdingResult:
    gross: float
    withheld: int
    net: float
    period: str
    residency: str
    annual_income: float
    annual_tax: float
    lito_applied: float
    stsl_annual: float

    def to_bas_components(self) -> Dict[str, float]:
        return {
            "wages_gross": self.gross,
            "wages_withheld": float(self.withheld),
        }

    def to_dict(self) -> Dict[str, float]:
        return {
            'gross': self.gross,
            'withheld': float(self.withheld),
            'net': self.net,
            'period': self.period,
            'residency': self.residency,
            'annual_income': self.annual_income,
            'annual_tax': self.annual_tax,
            'lito_applied': self.lito_applied,
            'stsl_annual': self.stsl_annual,
        }


def _dec(value: Any) -> Decimal:
    return Decimal(str(value))


def _round_amount(value: Decimal, mode: str) -> Decimal:
    quant = Decimal("1") if mode == "NEAREST_DOLLAR" else Decimal("0.01")
    return value.quantize(quant, rounding=ROUND_HALF_UP)


def _compute_tax(annual_income: Decimal, brackets: Any) -> Decimal:
    tax = Decimal("0")
    for bracket in sorted(brackets, key=lambda b: b["threshold"]):
        threshold = _dec(bracket["threshold"])
        if annual_income < threshold:
            break
        base = _dec(bracket["base_tax"])
        rate = _dec(bracket["rate"])
        tax = base + (annual_income - threshold) * rate
    return tax if tax >= 0 else Decimal("0")


def _compute_lito(annual_income: Decimal, cfg: Dict[str, Any]) -> Decimal:
    if not cfg:
        return Decimal("0")
    max_offset = _dec(cfg.get("max_offset", 0))
    start = _dec(cfg.get("phase_out_start", 0))
    end = _dec(cfg.get("phase_out_end", 0))
    rate_one = _dec(cfg.get("phase_out_rate", 0))
    second_rate = _dec(cfg.get("second_phase_rate", 0))
    second_end = _dec(cfg.get("second_phase_end", 0))

    if annual_income <= start:
        return max_offset

    offset = max_offset
    if annual_income <= end:
        offset -= (annual_income - start) * rate_one
        return offset if offset > 0 else Decimal("0")

    offset -= (end - start) * rate_one
    if annual_income <= second_end:
        offset -= (annual_income - end) * second_rate
        return offset if offset > 0 else Decimal("0")

    offset -= (second_end - end) * second_rate
    return offset if offset > 0 else Decimal("0")


def _compute_stsl(annual_income: Decimal, cfg: Dict[str, Any]) -> Decimal:
    thresholds = sorted(cfg.get("thresholds", []), key=lambda b: b["threshold"])
    rate = Decimal("0")
    for entry in thresholds:
        threshold = _dec(entry["threshold"])
        if annual_income >= threshold:
            rate = _dec(entry["rate"])
        else:
            break
    return annual_income * rate


def _select_scale(rules: Dict[str, Any], residency: str, flags: Dict[str, Any]) -> Dict[str, Any]:
    scales = rules.get("scales", {})
    if residency == "resident":
        tft = bool(flags.get("tax_free_threshold", True))
        key = "resident_tft" if tft else "resident_no_tft"
    elif residency == "foreign":
        key = "foreign"
    elif residency in {"working_holiday", "whm"}:
        key = "working_holiday"
    elif residency in {"no_tfn", "untaxed"}:
        key = "no_tfn"
    else:
        raise ValueError(f"Unsupported residency '{residency}'")

    if key not in scales:
        raise ValueError(f"PAYG configuration missing scale '{key}' for residency '{residency}'")
    return scales[key]


def compute_withholding(
    gross: float,
    period: str,
    residency: str,
    flags: Dict[str, Any] | None = None,
) -> WithholdingResult:
    flags = flags or {}
    gross_dec = _dec(gross)
    if gross_dec <= 0:
        return WithholdingResult(
            gross=float(gross_dec.quantize(Decimal("0.01"))),
            withheld=0,
            net=float(gross_dec.quantize(Decimal("0.01"))),
            period=period,
            residency=residency,
            annual_income=0.0,
            annual_tax=0.0,
            lito_applied=0.0,
            stsl_annual=0.0,
        )

    rules = load_payg_rules(period)
    factor = _dec(rules.get("annual_factor", 52))
    rounding_mode = rules.get("rounding", {}).get("mode", "NEAREST_DOLLAR")

    annual_income = gross_dec * factor
    scale = _select_scale(rules, residency, flags)
    annual_tax = _compute_tax(annual_income, scale.get("tax_brackets", []))

    lito = Decimal("0")
    if residency == "resident":
        lito = _compute_lito(annual_income, rules.get("lito", {}))
        annual_tax = annual_tax - lito
        if annual_tax < 0:
            annual_tax = Decimal("0")

    stsl_amount = Decimal("0")
    if flags.get("stsl"):
        stsl_amount = _compute_stsl(annual_income, rules.get("stsl", {}))
        annual_tax += stsl_amount

    withholding = _round_amount(annual_tax / factor, rounding_mode)
    net = gross_dec - withholding

    return WithholdingResult(
        gross=float(gross_dec.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        withheld=int(withholding),
        net=float(net.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        period=period,
        residency=residency,
        annual_income=float(annual_income),
        annual_tax=float(annual_tax),
        lito_applied=float(lito),
        stsl_annual=float(stsl_amount),
    )
