import pytest
from app.tax_rules import gst_line_tax, paygw_weekly

@pytest.mark.parametrize("amount_cents, expected", [
    (0, 0),
    (1000, 100),   # 10% GST
    (999, 100),    # rounding check
])
def test_gst(amount_cents, expected):
    assert gst_line_tax(amount_cents, "GST") == expected

@pytest.mark.parametrize("gross, expected", [
    (35_000, 0),
    (43_800, 1_522),
    (54_800, 4_041),
    (72_100, 10_169),
    (86_500, 15_142),
    (100_000, 20_700),
])
def test_paygw(gross, expected):
    assert paygw_weekly(gross) == expected
