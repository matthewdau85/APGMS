from app.tax_rules import gst_line_tax, paygw_withholding


def test_gst_line_tax_table_driven():
    assert gst_line_tax(10000, "GST") == 1000
    assert gst_line_tax(10000, "GST_FREE") == 0
    assert gst_line_tax(10000, "INPUT_TAXED") == 0


def test_paygw_weekly_matches_example():
    withholding = paygw_withholding(150000, period="weekly", tax_free_threshold=True, stsl=False)
    assert withholding == 30285


def test_paygw_monthly_without_tft():
    withholding = paygw_withholding(600000, period="monthly", tax_free_threshold=False, stsl=False)
    assert withholding == 139500
