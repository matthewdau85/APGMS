import calendar
from datetime import date
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from engine.payroll_tax import (
    annual_reconciliation,
    compute_monthly_liability,
    load_rules,
)


@pytest.mark.parametrize(
    "state",
    ["nsw", "NSW"],
)
def test_load_rules_case_insensitive(state):
    rules = load_rules(state, 2024)
    assert rules["state"] == "NSW"


def test_monthly_liability_nsw_with_levy():
    wage_records = [
        {"entity": "Alpha", "group": "GroupNSW", "wages": 75000, "nexus": "NSW"},
        {"entity": "Beta", "group": "GroupNSW", "wages": 80000, "nexus": "NSW"},
    ]
    result = compute_monthly_liability("NSW", 2024, wage_records, "2024-05-31")

    assert result["total_wages"] == pytest.approx(155000.0, abs=0.01)
    assert result["taxable_wages"] == pytest.approx(55000.0, abs=0.01)
    assert result["tax"] == pytest.approx(2667.5, abs=0.01)
    assert result["levies"]["Mental Health Levy"] == pytest.approx(55.0, abs=0.01)
    assert result["total_liability"] == pytest.approx(2722.5, abs=0.01)


def test_monthly_liability_nsw_levy_expired():
    wage_records = [
        {"entity": "Alpha", "group": "GroupNSW", "wages": 75000, "nexus": "NSW"},
        {"entity": "Beta", "group": "GroupNSW", "wages": 80000, "nexus": "NSW"},
    ]
    result = compute_monthly_liability("NSW", 2024, wage_records, "2024-07-31")

    assert "Mental Health Levy" not in result["levies"]
    assert result["tax"] == pytest.approx(2667.5, abs=0.01)
    assert result["total_liability"] == pytest.approx(2667.5, abs=0.01)


def test_monthly_liability_vic_filters_nexus_and_applies_levy():
    wage_records = [
        {"entity": "VicCoA", "group": "VicGroup", "wages": 40000, "nexus": "VIC"},
        {"entity": "VicCoB", "group": "VicGroup", "wages": 30000, "nexus": "VIC"},
        {"entity": "NSWCo", "group": "VicGroup", "wages": 50000, "nexus": "NSW"},
    ]
    result = compute_monthly_liability("VIC", 2024, wage_records, date(2024, 3, 31))

    assert result["total_wages"] == pytest.approx(70000.0, abs=0.01)
    assert result["taxable_wages"] == pytest.approx(11667.0, abs=1.0)
    assert result["tax"] == pytest.approx(542.52, abs=0.1)
    assert result["levies"]["Mental Health and Wellbeing Surcharge"] == pytest.approx(350.0, abs=0.01)
    assert result["total_liability"] == pytest.approx(892.52, abs=0.5)


def test_grouping_and_multi_tier_rates_for_qld():
    wage_records = [
        {"entity": "QLD1", "group": "GroupA", "wages": 90000, "nexus": "QLD"},
        {"entity": "QLD2", "group": "GroupA", "wages": 30000, "nexus": "QLD"},
        {"entity": "QLD3", "group": "GroupB", "wages": 50000, "nexus": "QLD"},
    ]
    result = compute_monthly_liability("QLD", 2024, wage_records, date(2024, 2, 29))

    assert result["group_totals"]["GroupA"] == pytest.approx(120000.0, abs=0.01)
    assert result["taxable_wages_by_group"]["GroupA"] == pytest.approx(11667.0, abs=1.0)
    assert result["taxable_wages_by_group"].get("GroupB", 0.0) == pytest.approx(0.0, abs=0.01)
    assert result["tax"] == pytest.approx(523.0, abs=1.0)
    assert result["levies"]["Health Services Levy"] == pytest.approx(5.83, abs=0.1)


def test_levy_turns_off_after_effective_date_for_qld():
    wage_records = [
        {"entity": "QLD1", "group": "GroupA", "wages": 90000, "nexus": "QLD"},
        {"entity": "QLD2", "group": "GroupA", "wages": 30000, "nexus": "QLD"},
    ]
    result = compute_monthly_liability("QLD", 2024, wage_records, date(2024, 4, 30))

    assert result["tax"] == pytest.approx(523.0, abs=1.0)
    assert result["levies"] == {}


def test_annual_reconciliation_nsw():
    wage_records = [{"entity": "Alpha", "group": "GroupNSW", "wages": 130000, "nexus": "NSW"}]
    monthly_results = [
        compute_monthly_liability("NSW", 2024, wage_records, date(2024, month, calendar.monthrange(2024, month)[1]))
        for month in range(1, 13)
    ]

    reconciliation = annual_reconciliation("NSW", 2024, monthly_results)

    assert reconciliation["total_wages"] == pytest.approx(1560000.0, abs=0.1)
    assert reconciliation["taxable_wages"] == pytest.approx(360000.0, abs=0.1)
    assert reconciliation["annual_tax"] == pytest.approx(17460.0, abs=0.1)
    assert reconciliation["tax_paid"] == pytest.approx(17460.0, abs=0.1)
    assert reconciliation["levies_paid"] == pytest.approx(180.0, abs=0.1)
    assert reconciliation["balance"] == pytest.approx(0.0, abs=0.1)
