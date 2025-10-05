import pytest
from app.tax_rules import gst_line_tax, paygw_weekly

@pytest.mark.parametrize("amount_cents, expected", [
    (0, 0),
    (1000, 100),   # 10% GST
    (999, 100),    # rounding check
])
def test_gst(amount_cents, expected):
    assert gst_line_tax(amount_cents, "GST") == expected

@pytest.mark.parametrize("gross_cents, kwargs, expected", [
    (150_000, {}, 30_285),
    (200_000, {"tax_free_threshold": False}, 46_285),
    (200_000, {"stsl": True}, 56_285),
])
def test_paygw(gross_cents, kwargs, expected):
    assert paygw_weekly(gross_cents, **kwargs) == expected
