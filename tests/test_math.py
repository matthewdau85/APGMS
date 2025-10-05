import pytest
from app.tax_rules import gst_line_tax, paygw_withholding

@pytest.mark.parametrize("amount_cents, expected", [
    (0, 0),
    (1000, 100),
    (999, 100),
])
def test_gst(amount_cents, expected):
    assert gst_line_tax(amount_cents, "GST") == expected

@pytest.mark.parametrize("gross_cents, expected", [
    (150_000, 30_285),
    (200_000, 46_285),
])
def test_paygw_weekly_table(gross_cents, expected):
    assert paygw_withholding(gross_cents, period="weekly", tax_free_threshold=True, stsl=False) == expected
