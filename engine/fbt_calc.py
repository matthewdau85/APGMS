"""Core calculations for Australian Fringe Benefits Tax (FBT)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Dict, Literal, Optional

from .fbt_calendar import FBTCalendar

RulesDict = Dict[str, object]


@dataclass
class CarBenefitInput:
    """Input payload describing a car fringe benefit scenario."""

    base_value: float
    acquisition_date: date
    days_available: int = 365
    employee_contribution: float = 0.0
    operating_costs: Optional[Dict[str, float]] = None
    business_use_percentage: float = 0.0
    has_gst_credit: bool = True
    is_electric: bool = False
    co2_emissions: Optional[float] = None
    purchase_price: Optional[float] = None

    def private_use_percentage(self) -> float:
        business = max(0.0, min(1.0, self.business_use_percentage))
        return 1.0 - business


@dataclass
class FBTCarBenefitResult:
    """Result bundle for a car fringe benefit calculation."""

    method: Literal["statutory", "operating"]
    taxable_value: float
    gross_up_type: Literal["type1", "type2"]
    grossed_up_value: float
    reportable_amount: float
    ev_exempt: bool
    details: Dict[str, float] = field(default_factory=dict)

    @property
    def has_gst_credit(self) -> bool:
        return self.gross_up_type == "type1"


def calculate_car_benefit(
    payload: CarBenefitInput, fbt_year: int | str, method: Literal["statutory", "operating"]
) -> FBTCarBenefitResult:
    """Calculate the taxable value and RFBA for the supplied car fringe benefit."""

    rules = load_rules(fbt_year)
    ev_exempt = _is_ev_exempt(payload, rules, fbt_year)
    if ev_exempt:
        return FBTCarBenefitResult(
            method=method,
            taxable_value=0.0,
            gross_up_type="type1" if payload.has_gst_credit else "type2",
            grossed_up_value=0.0,
            reportable_amount=0.0,
            ev_exempt=True,
            details={"base_value": payload.base_value, "reduced_base_value": 0.0},
        )

    base_value = _reduced_base_value(payload, rules, fbt_year)
    if method == "statutory":
        taxable = _statutory_taxable_value(payload, rules, base_value)
    elif method == "operating":
        taxable = _operating_taxable_value(payload, rules, base_value)
    else:
        raise ValueError("method must be 'statutory' or 'operating'")

    gross_up_type = "type1" if payload.has_gst_credit else "type2"
    gross_up_factor = float(rules["gross_up_factors"][gross_up_type])  # type: ignore[index]
    grossed_up_value = taxable * gross_up_factor

    rfba_threshold = float(rules["thresholds"]["rfba_minimum"])  # type: ignore[index]
    rfba_factor = float(rules["gross_up_factors"]["type2"])  # type: ignore[index]
    reportable_amount = taxable * rfba_factor if taxable > rfba_threshold else 0.0

    return FBTCarBenefitResult(
        method=method,
        taxable_value=round(taxable, 2),
        gross_up_type=gross_up_type,
        grossed_up_value=round(grossed_up_value, 2),
        reportable_amount=round(reportable_amount, 2),
        ev_exempt=False,
        details={
            "base_value": round(payload.base_value, 2),
            "reduced_base_value": round(base_value, 2),
            "private_use_percentage": round(payload.private_use_percentage(), 4),
        },
    )


def compare_car_methods(payload: CarBenefitInput, fbt_year: int | str) -> Dict[str, FBTCarBenefitResult]:
    """Evaluate the car fringe benefit under both statutory and operating cost methods."""

    return {
        "statutory": calculate_car_benefit(payload, fbt_year, method="statutory"),
        "operating": calculate_car_benefit(payload, fbt_year, method="operating"),
    }


def _statutory_taxable_value(payload: CarBenefitInput, rules: RulesDict, base_value: float) -> float:
    car_rules = rules["car_benefit"]  # type: ignore[index]
    statutory_fraction = float(car_rules["statutory_fraction"])  # type: ignore[index]
    days_in_year = int(car_rules["days_in_year"])  # type: ignore[index]
    days_available = max(0, min(payload.days_available, days_in_year))
    taxable = base_value * statutory_fraction * (days_available / days_in_year)
    taxable -= payload.employee_contribution
    return max(0.0, taxable)


def _operating_taxable_value(payload: CarBenefitInput, rules: RulesDict, base_value: float) -> float:
    operating_costs = payload.operating_costs or {}
    total_costs = sum(float(value) for value in operating_costs.values())
    base_reduction = payload.base_value - base_value
    if base_reduction > 0 and operating_costs:
        depreciation_key = next(
            (key for key in operating_costs.keys() if "depr" in key.lower()),
            None,
        )
        if depreciation_key is not None:
            depreciation = float(operating_costs[depreciation_key])
            adjusted_depreciation = max(0.0, depreciation - base_reduction)
            total_costs = total_costs - depreciation + adjusted_depreciation
        else:
            total_costs = max(0.0, total_costs - min(total_costs, base_reduction))
    private_use = payload.private_use_percentage()
    taxable = total_costs * private_use
    taxable -= payload.employee_contribution
    return max(0.0, taxable)


def _reduced_base_value(payload: CarBenefitInput, rules: RulesDict, fbt_year: int | str) -> float:
    car_rules = rules["car_benefit"]  # type: ignore[index]
    reduction_wait = int(car_rules["base_value_reduction_years"])  # type: ignore[index]
    max_reductions = int(car_rules.get("maximum_reductions", 3))
    acquisition_year = FBTCalendar.from_date(payload.acquisition_date).label
    current_year = int(fbt_year)
    years_elapsed = max(0, current_year - acquisition_year)
    reductions = max(0, years_elapsed - reduction_wait)
    reductions = min(reductions, max_reductions)
    reduction_fraction = 1 - (reductions / 3)
    reduction_fraction = max(0.0, reduction_fraction)
    return payload.base_value * reduction_fraction


def _is_ev_exempt(payload: CarBenefitInput, rules: RulesDict, fbt_year: int | str) -> bool:
    config = rules.get("ev_exemption", {})  # type: ignore[assignment]
    if not config or not bool(config.get("enabled", False)):
        return False
    first_year = int(config.get("first_applicable_year", fbt_year))
    if int(fbt_year) < first_year:
        return False
    if not payload.is_electric:
        return False
    threshold = config.get("lct_threshold")
    if threshold is not None and payload.purchase_price is not None:
        if payload.purchase_price > float(threshold):
            return False
    co2_threshold = config.get("co2_threshold")
    if co2_threshold is not None and payload.co2_emissions is not None:
        if payload.co2_emissions > float(co2_threshold):
            return False
    zero_required = config.get("ev_zero_emissions_required", False)
    if zero_required and payload.co2_emissions not in (None, 0, 0.0):
        return False
    return True


@lru_cache(maxsize=8)
def load_rules(year: int | str) -> RulesDict:
    """Load the JSON rule set for the requested FBT year."""

    label = int(year)
    rules_path = Path(__file__).resolve().parent.parent / "rules" / f"fbt_{label}.json"
    data = rules_path.read_text(encoding="utf-8")
    import json

    return json.loads(data)

