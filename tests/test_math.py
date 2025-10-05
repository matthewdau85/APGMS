import doctest

import pytest

import app.tax_rules
from app.tax_rules import gst_line_tax, paygw_weekly


@pytest.mark.parametrize("amount_cents, expected", [
    (0, 0),
    (1000, 100),   # 10% GST
    (999, 100),    # rounding check
])
def test_gst(amount_cents, expected):
    assert gst_line_tax(amount_cents, "GST") == expected


@pytest.mark.parametrize("gross, expected", [
    (35_900, 0),          # below first bracket (TFT scale)
    (43_800, 1_522),      # top of second bracket
    (72_100, 10_169),     # inside higher bracket
])
def test_paygw_progressive(gross, expected):
    assert paygw_weekly(gross) == expected


def test_paygw_bracket_boundary_switch():
    assert paygw_weekly(43_800) == 1_522
    assert paygw_weekly(43_801) == 1_467


def test_tax_rules_doc_examples():
    failures, _ = doctest.testmod(app.tax_rules)
    assert failures == 0
