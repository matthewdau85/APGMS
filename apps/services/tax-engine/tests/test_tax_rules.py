from app.tax_rules import gst_line_tax, paygw_weekly


def test_gst_line_tax():
    assert gst_line_tax(10000, 'GST') == 1000
    assert gst_line_tax(10000, 'GST_FREE') == 0


def test_paygw_weekly():
    assert paygw_weekly(43800) == 1522
    assert paygw_weekly(72100) == 10169
