from __future__ import annotations

from decimal import Decimal

import pytest

from app.engine import etp_calc, paygw_calc
from app.tax_rules import calculate_paygw, gst_line_tax


def test_gst_line_tax():
    assert gst_line_tax(10000, "GST") == 1000
    assert gst_line_tax(10000, "GST_FREE") == 0


GOLDEN_CASES = [
    (
        "resident",
        "weekly",
        True,
        [(200, 0), (800, 82), (1200, 198), (2000, 485)],
    ),
    (
        "resident",
        "weekly",
        False,
        [(200, 38), (800, 191), (1200, 329), (2000, 625)],
    ),
    (
        "resident",
        "fortnightly",
        True,
        [(400, 0), (1200, 87), (2000, 266), (3000, 600)],
    ),
    (
        "resident",
        "fortnightly",
        False,
        [(400, 76), (1200, 254), (2000, 510), (3000, 880)],
    ),
    (
        "resident",
        "monthly",
        True,
        [(2000, 99), (4000, 531), (6000, 1199), (8000, 1939)],
    ),
    (
        "resident",
        "monthly",
        False,
        [(2000, 380), (4000, 1020), (6000, 1760), (8000, 2500)],
    ),
    (
        "resident",
        "quarterly",
        True,
        [(8000, 606), (16000, 2701), (24000, 5562), (32000, 8522)],
    ),
    (
        "resident",
        "quarterly",
        False,
        [(8000, 1715), (16000, 4425), (24000, 7385), (32000, 10345)],
    ),
    (
        "foreign_resident",
        "weekly",
        None,
        [(500, 163), (1000, 348), (2000, 798), (3500, 1473)],
    ),
    (
        "working_holiday",
        "weekly",
        None,
        [(500, 75), (1000, 173), (2000, 510), (3500, 1031)],
    ),
]


@pytest.mark.parametrize("residency, period, tax_free_threshold, fixtures", GOLDEN_CASES)
def test_golden_tables(residency: str, period: str, tax_free_threshold: bool | None, fixtures):
    for gross, expected in fixtures:
        payload = {"residency": residency, "period": period, "gross": gross}
        if tax_free_threshold is not None:
            payload["tax_free_threshold"] = tax_free_threshold
        result = calculate_paygw(payload)
        assert result["total_withholding"] == pytest.approx(expected)


@pytest.mark.parametrize(
    "residency, period, tax_free_threshold",
    [
        ("resident", "weekly", True),
        ("resident", "weekly", False),
        ("resident", "fortnightly", True),
        ("foreign_resident", "weekly", None),
        ("working_holiday", "weekly", None),
    ],
)
def test_monotonic_within_brackets(residency: str, period: str, tax_free_threshold: bool | None):
    brackets = list(paygw_calc.withholding_table("2024_25", residency, period, tax_free_threshold=bool(tax_free_threshold)))
    for bracket in brackets:
        start = bracket.threshold
        end = bracket.limit if bracket.limit is not None else start + Decimal("1000")
        if end <= start:
            continue
        step = max(Decimal("1"), (end - start) / Decimal("10"))
        gross = start + step
        previous = None
        while gross < end:
            payload = {"residency": residency, "period": period, "gross": float(gross)}
            if residency == "resident":
                payload["tax_free_threshold"] = bool(tax_free_threshold)
            result = calculate_paygw(payload)
            amount = result["withholding"]
            if previous is not None:
                assert amount + 1e-9 >= previous
            previous = amount
            gross += step


def test_stsl_threshold_step_change():
    low = calculate_paygw(
        {
            "residency": "resident",
            "period": "weekly",
            "gross": 1150,
            "tax_free_threshold": True,
            "stsl": True,
            "payment_date": "2024-07-01",
        }
    )
    high = calculate_paygw(
        {
            "residency": "resident",
            "period": "weekly",
            "gross": 1300,
            "tax_free_threshold": True,
            "stsl": True,
            "payment_date": "2024-07-01",
        }
    )
    assert low["stsl"] == pytest.approx(12)
    assert high["stsl"] == pytest.approx(26)
    assert high["total_withholding"] >= low["total_withholding"]


def test_stsl_before_indexation_is_zero():
    result = calculate_paygw(
        {
            "residency": "resident",
            "period": "weekly",
            "gross": 1300,
            "tax_free_threshold": True,
            "stsl": True,
            "payment_date": "2024-05-15",
        }
    )
    assert result["stsl"] == 0


def test_etp_component_under_cap():
    result = etp_calc.calculate({"components": [{"type": "A", "amount": 50000, "preservation": "under"}]})
    comp = result["components"][0]
    assert comp["withheld"] == pytest.approx(8500)
    assert result["stp2_summary"]["ETP-TYPE-A"] == pytest.approx(8500)


def test_etp_cap_application_and_rounding():
    result = etp_calc.calculate(
        {
            "life_cap_used": 100000,
            "whole_of_income_used": 0,
            "components": [
                {"type": "A", "amount": 300000, "preservation": "under"},
            ],
        }
    )
    comp = result["components"][0]
    assert comp["withheld"] == pytest.approx(100500)
    assert result["stp2_summary"]["ETP-TYPE-A"] == pytest.approx(100500)


def test_lump_sum_whole_dollar_rounding():
    result = etp_calc.calculate({"components": [{"type": "E", "amount": 12345}]})
    comp = result["components"][0]
    assert comp["withheld"] == pytest.approx(3950)
    assert result["stp2_summary"]["LUMP-SUM-E"] == pytest.approx(3950)
