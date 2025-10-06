from app.money import from_cents, to_cents
from app.tax_rules import gst_line_tax, paygw_weekly


def test_gst_line_tax():
    assert to_cents(gst_line_tax(from_cents(10000), 'GST')) == 1000
    assert to_cents(gst_line_tax(from_cents(10000), 'GST_FREE')) == 0


def test_paygw_weekly():
    assert to_cents(paygw_weekly(from_cents(50000))) == 7500
    assert to_cents(paygw_weekly(from_cents(100000))) > 15000
