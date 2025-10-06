from datetime import date
from decimal import Decimal

from app.engine import (
    compute_super_guarantee,
    compute_super_guarantee_charge,
    load_quarter_rules,
    resolve_rate_for_date,
)


def test_super_guarantee_ote_and_mcb_cap():
    load_quarter_rules()  # ensure rules cached for consistent assertions
    result = compute_super_guarantee(
        {
            "quarter": "2024Q1",
            "earnings": [
                {"code": "salary", "amount": 72000},
                {"code": "bonus", "amount": 6000},
                {"code": "allowance", "amount": 5000},
                {"code": "overtime", "amount": 4000},  # excluded from OTE
            ],
            "salary_sacrifice": {"pre_tax": 2000, "post_tax": 500},
        }
    )

    assert result["ote"] == 83000.0  # allowance, salary and bonus only
    assert result["ote_capped"] == 65070.0
    assert result["required_contribution"] == 7483.05
    assert result["recommended_employer_contribution"] == 5483.05
    assert result["salary_sacrifice"]["pre_tax"] == 2000.0
    assert result["package_total"] == 7983.05
    breakdown_codes = {row["code"] for row in result["ote_breakdown"]}
    assert breakdown_codes == {"SALARY", "BONUS", "ALLOWANCE"}


def test_sg_rate_schedule_future_increase():
    load_quarter_rules()
    assert resolve_rate_for_date(date(2024, 6, 30)) == Decimal("0.11")
    assert resolve_rate_for_date(date(2024, 7, 1)) == Decimal("0.115")
    assert resolve_rate_for_date(date(2025, 7, 1)) == Decimal("0.12")


def test_sgc_late_payment_components_and_evidence():
    load_quarter_rules()
    sg_result = compute_super_guarantee(
        {
            "quarter": "2024Q1",
            "earnings": [
                {"code": "salary", "amount": 72000},
                {"code": "bonus", "amount": 6000},
                {"code": "allowance", "amount": 5000},
                {"code": "overtime", "amount": 4000},
            ],
            "salary_sacrifice": {"pre_tax": 2000, "post_tax": 500},
        }
    )

    sgc_result = compute_super_guarantee_charge(
        {
            "due_date": "2024-10-28",
            "contributions": [
                {"amount": 3000, "date": "2024-10-15", "reference": "on time"},
                {"amount": 2483.05, "date": "2024-12-15", "reference": "late catch-up"},
            ],
        },
        sg_result,
    )

    assert sgc_result["status"] == "late"
    assert sgc_result["shortfall"] == 2483.05
    assert sgc_result["nominal_interest"] == 113.61
    assert sgc_result["admin_fee"] == 20.0
    assert sgc_result["sg_charge"] == 2616.66
    assert any("non-deductible" in line for line in sgc_result["evidence"])
    assert any("late catch-up" in line for line in sgc_result["evidence"])
    assert len(sgc_result["late_contributions"]) == 1
    assert sgc_result["late_contributions"][0]["reference"] == "late catch-up"
