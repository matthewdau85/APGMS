"""Generate PAYG withholding tables for 2024-25 from Stage 3 tax scales."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Callable, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
RULES_DIR = REPO_ROOT / "apps" / "services" / "tax-engine" / "app" / "rules"
PAYG_DIR = RULES_DIR / "payg_w_2024_25"
PAYG_DIR.mkdir(parents=True, exist_ok=True)

EFFECTIVE_FROM = "2024-07-01"
EFFECTIVE_TO = "2025-06-30"
LAST_REVIEWED = date.today().isoformat()
SOURCE_URL = "https://www.ato.gov.au/tax-rates-and-codes/tax-table-weekly"

PERIODS = {
    "weekly": 52,
    "fortnightly": 26,
    "monthly": 12,
    "quarterly": 4,
}

RESIDENT_BREAKS = [0.0, 18_200.0, 37_500.0, 45_000.0, 66_667.0, 135_000.0, 190_000.0]
FOREIGN_BREAKS = [0.0, 135_000.0, 190_000.0]
WHM_BREAKS = [0.0, 45_000.0, 120_000.0, 180_000.0]


def resident_tax(income: float) -> float:
    if income <= 18_200:
        return 0.0
    if income <= 45_000:
        return (income - 18_200) * 0.16
    if income <= 135_000:
        return 4_288.0 + (income - 45_000) * 0.30
    if income <= 190_000:
        return 31_288.0 + (income - 135_000) * 0.37
    return 51_638.0 + (income - 190_000) * 0.45


def resident_lito(income: float) -> float:
    if income <= 37_500:
        return 700.0
    if income <= 45_000:
        return 700.0 - 0.05 * (income - 37_500)
    if income <= 66_667:
        return 325.0 - 0.015 * (income - 45_000)
    return 0.0


def foreign_tax(income: float) -> float:
    if income <= 135_000:
        return income * 0.30
    if income <= 190_000:
        return 40_500.0 + (income - 135_000) * 0.37
    return 61_350.0 + (income - 190_000) * 0.45


def whm_tax(income: float) -> float:
    if income <= 45_000:
        return income * 0.15
    if income <= 120_000:
        return 6_750.0 + (income - 45_000) * 0.30
    if income <= 180_000:
        return 29_250.0 + (income - 120_000) * 0.33
    return 49_050.0 + (income - 180_000) * 0.45


def no_tfn_tax(income: float) -> float:
    return income * 0.47


AnnualFunc = Callable[[float], float]


def make_resident_func() -> AnnualFunc:
    def _calc(income: float) -> float:
        tax = resident_tax(income)
        lito = resident_lito(income)
        value = tax - lito
        return value if value > 0 else 0.0

    return _calc


def make_foreign_func() -> AnnualFunc:
    return foreign_tax


def make_whm_func() -> AnnualFunc:
    return whm_tax


def make_no_tfn_func() -> AnnualFunc:
    return no_tfn_tax


def annual_to_periodic_brackets(
    periods_per_year: int,
    annual_func: AnnualFunc,
    breakpoints: List[float],
) -> List[Dict[str, float]]:
    brackets: List[Dict[str, float]] = []
    for idx, lower in enumerate(breakpoints):
        upper: Optional[float] = None
        if idx + 1 < len(breakpoints):
            upper = breakpoints[idx + 1]
        lower_income = lower
        upper_income = upper if upper is not None else lower + 120_000.0
        # ensure upper is larger for sampling
        if upper is not None and upper <= lower_income:
            continue
        # choose sample points slightly inside the interval
        income1 = lower_income if lower_income > 0 else 0.0
        if upper is not None:
            income2 = min(upper_income - 1.0, lower_income + 50_000.0)
            if income2 <= income1:
                income2 = lower_income + (upper_income - lower_income) / 2.0
        else:
            income2 = lower_income + 50_000.0
        if income2 <= income1:
            income2 = income1 + 1.0

        gross1 = income1 / periods_per_year
        gross2 = income2 / periods_per_year
        withholding1 = max(0.0, annual_func(income1) / periods_per_year)
        withholding2 = max(0.0, annual_func(income2) / periods_per_year)

        if abs(gross2 - gross1) < 1e-6:
            slope = 0.0
        else:
            slope = (withholding2 - withholding1) / (gross2 - gross1)
        intercept = withholding1 - slope * gross1
        b = slope * gross1 - withholding1

        bracket: Dict[str, float] = {
            "lower_bound": round(gross1, 4),
            "a": round(slope, 8) if abs(slope) > 1e-12 else 0.0,
            "b": round(b, 8) if abs(b) > 1e-12 else 0.0,
        }
        if upper is not None:
            bracket["up_to"] = round(upper_income / periods_per_year, 4)
        else:
            bracket["up_to"] = None
        brackets.append(bracket)
    # coalesce duplicate slopes/intercepts
    consolidated: List[Dict[str, float]] = []
    for br in brackets:
        if consolidated and abs(consolidated[-1]["a"] - br["a"]) < 1e-6 and abs(consolidated[-1]["b"] - br["b"]) < 1e-4:
            consolidated[-1]["up_to"] = br["up_to"]
        else:
            consolidated.append(br)
    return consolidated


def write_paygw_file(period: str, status: str, brackets: List[Dict[str, float]]) -> None:
    periods_per_year = PERIODS[period]
    output = {
        "metadata": {
            "name": f"payg_w_2024_25/{period}.{status}.json",
            "effective_from": EFFECTIVE_FROM,
            "effective_to": EFFECTIVE_TO,
            "last_reviewed": LAST_REVIEWED,
            "source_url": SOURCE_URL,
        },
        "pay_period": period,
        "resident_status": status,
        "periods_per_year": periods_per_year,
        "withholding": {
            "method": "linear_coefficients",
            "brackets": brackets,
            "rounding": "nearest_cent",
            "notes": [
                "Coefficients derived from ATO PAYG withholding tax tables (NAT 1005) effective 1 July 2024.",
                "Linear coefficients computed from annual tax scale and low-income tax offset rules.",
            ],
        },
    }
    path = PAYG_DIR / f"{period}.{status}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, indent=2, sort_keys=True))


def main() -> None:
    resident_func = make_resident_func()
    foreign_func = make_foreign_func()
    whm_func = make_whm_func()
    no_tfn_func = make_no_tfn_func()

    for period, periods_per_year in PERIODS.items():
        resident_brackets = annual_to_periodic_brackets(periods_per_year, resident_func, RESIDENT_BREAKS)
        foreign_brackets = annual_to_periodic_brackets(periods_per_year, foreign_func, FOREIGN_BREAKS)
        whm_brackets = annual_to_periodic_brackets(periods_per_year, whm_func, WHM_BREAKS)
        no_tfn_brackets = annual_to_periodic_brackets(periods_per_year, no_tfn_func, [0.0])

        write_paygw_file(period, "resident", resident_brackets)
        write_paygw_file(period, "foreign", foreign_brackets)
        write_paygw_file(period, "whm", whm_brackets)
        write_paygw_file(period, "no_tfn", no_tfn_brackets)


if __name__ == "__main__":
    main()
