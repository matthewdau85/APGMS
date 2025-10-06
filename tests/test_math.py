import pytest

from app.money import from_cents, to_cents
from app.tax_rules import gst_line_tax, paygw_weekly

@pytest.mark.parametrize("amount_cents, expected", [
    (0, 0),
    (1000, 100),   # 10% GST
    (999, 100),    # rounding check
])
def test_gst(amount_cents, expected):
    assert to_cents(gst_line_tax(from_cents(amount_cents), "GST")) == expected

@pytest.mark.parametrize("gross, expected", [
    (50_000, 7_500),     # 15% below bracket
    (80_000, 12_000),    # top of bracket
    (100_000, 16_000),   # 12,000 + 20% of 20,000
])
def test_paygw(gross, expected):
    assert to_cents(paygw_weekly(from_cents(gross))) == expected
