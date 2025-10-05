import pytest
from app.tax_rules import gst_line_tax, paygw_weekly


@pytest.mark.parametrize(
    "amount_cents, tax_code, kind, expected",
    [
        (0, "GST", "sale", 0),
        (100000, "GST", "sale", 10000),
        (75000, "GST", "purchase", -7500),
    ],
)
def test_gst(amount_cents, tax_code, kind, expected):
    assert gst_line_tax(amount_cents, tax_code, kind=kind) == expected


@pytest.mark.parametrize(
    "gross, options, expected",
    [
        (150000, {"tax_free_threshold": True}, 27285),
        (150000, {"tax_free_threshold": False}, 34231),
        (90000, {"tax_free_threshold": True}, 8712),
    ],
)
def test_paygw(gross, options, expected):
    assert paygw_weekly(gross, **options) == expected
