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
    (50_000, 7_500),     # 15% below bracket
    (80_000, 12_000),    # top of bracket
    (100_000, 16_000),   # 12,000 + 20% of 20,000
])
def test_paygw(gross, expected):
    assert paygw_weekly(gross) == expected
