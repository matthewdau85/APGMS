import math
import sys
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from bas_fbt import FBTBASCalculator
from engine.fbt_calc import CarBenefitInput, calculate_car_benefit, compare_car_methods
from engine.fbt_calendar import FBTCalendar


@pytest.fixture(scope="module")
def sample_payload():
    return CarBenefitInput(
        base_value=42000,
        acquisition_date=date(2019, 7, 1),
        days_available=365,
        employee_contribution=1500,
        operating_costs={"fuel": 2800, "maintenance": 1400, "depreciation": 6000},
        business_use_percentage=0.55,
        has_gst_credit=True,
    )


def test_car_benefit_methods(sample_payload):
    results = compare_car_methods(sample_payload, 2025)
    statutory = results["statutory"]
    operating = results["operating"]

    assert statutory.method == "statutory"
    assert operating.method == "operating"
    # Statutory method should generally produce a higher taxable value when private use is moderate.
    assert statutory.taxable_value > operating.taxable_value
    # Reduced base value should reflect 1/3 reduction (car held more than 4 full FBT years).
    assert math.isclose(statutory.details["reduced_base_value"], 28000.0, rel_tol=1e-4)
    assert statutory.reportable_amount > 0


def test_electric_vehicle_exemption():
    ev_payload = CarBenefitInput(
        base_value=68000,
        acquisition_date=date(2024, 5, 10),
        is_electric=True,
        purchase_price=70000,
        co2_emissions=0,
    )
    result = calculate_car_benefit(ev_payload, 2025, method="statutory")
    assert result.ev_exempt is True
    assert result.taxable_value == 0
    assert result.reportable_amount == 0


def test_rfba_threshold_application(sample_payload):
    high_private_use = CarBenefitInput(
        base_value=52000,
        acquisition_date=date(2020, 8, 30),
        employee_contribution=0,
        business_use_percentage=0.1,
        has_gst_credit=False,
    )
    result = calculate_car_benefit(high_private_use, 2025, method="statutory")
    assert result.gross_up_type == "type2"
    assert result.reportable_amount > 0
    # Taxable value exceeds threshold and should be reflected in RFBA.
    assert result.reportable_amount == pytest.approx(result.taxable_value * 1.8868, rel=1e-4)


def test_bas_instalments_and_washup(sample_payload):
    calc = FBTBASCalculator(2025, frequency="quarterly")
    periods = list(FBTCalendar.iter_periods(2025))

    first_quarter_date = periods[0].start
    second_quarter_date = periods[1].start
    third_quarter_date = periods[2].start

    stat_result = calculate_car_benefit(sample_payload, 2025, method="statutory")
    op_result = calculate_car_benefit(sample_payload, 2025, method="operating")

    calc.record_benefit(first_quarter_date, stat_result)
    calc.record_benefit(second_quarter_date, op_result)
    calc.record_benefit(third_quarter_date, 1500.0, has_gst_credit=False)

    calc.set_instalment(0, F1=5000)
    calc.set_instalment(1, F1=4500)
    calc.set_instalment(2, F2=2000)

    report = calc.period_report()
    assert report[0]["F1"] > 0
    assert report[1]["F1"] > 0
    assert report[2]["F2"] > 0

    reconciliation = calc.annual_reconciliation()
    assert reconciliation["actual"]["F1"] >= report[0]["F1"] + report[1]["F1"]
    assert reconciliation["variance"]["F1"] == pytest.approx(
        reconciliation["actual"]["F1"] - (5000 + 4500), rel=1e-4
    )
    assert reconciliation["variance"]["F2"] == pytest.approx(
        reconciliation["actual"]["F2"] - 2000, rel=1e-4
    )

