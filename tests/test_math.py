import pytest
from app.tax_rules import calc_gst, calc_paygw, calc_penalty, DEFAULT_VERSION_ID


@pytest.mark.parametrize("amount_cents, expected", [
    (0, 0),
    (10_000, 1_000),
    (10_005, 1_001),
])
def test_calc_gst(amount_cents, expected):
    assert calc_gst(amount_cents, DEFAULT_VERSION_ID) == expected


@pytest.mark.parametrize("income, expected", [
    (1_820_000, 0),
    (4_500_000, 509_200),
    (8_000_000, 1_646_700),
])
def test_calc_paygw(income, expected):
    assert calc_paygw(income, DEFAULT_VERSION_ID) == expected


def test_calc_penalty_components():
    penalty = calc_penalty(45, 100_000, DEFAULT_VERSION_ID)
    assert penalty == 77_000
