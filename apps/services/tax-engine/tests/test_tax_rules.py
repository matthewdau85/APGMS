from app.tax_rules import gst_line_tax, paygw_weekly


def test_gst_line_tax_modes():
    assert gst_line_tax(10000, "GST") == 1000
    assert gst_line_tax(11000, "GST_INCLUSIVE") == 1000
    assert gst_line_tax(10000, "GST_FREE") == 0
    assert gst_line_tax(10000, "EXEMPT") == 0


def test_paygw_weekly_stage3_with_threshold():
    withholding = paygw_weekly(150000, financial_year="2024-25", tax_free_threshold=True)
    assert withholding == 30285


def test_paygw_weekly_stage3_no_threshold():
    withholding = paygw_weekly(150000, financial_year="2024-25", tax_free_threshold=False)
    assert withholding == 35885


def test_paygw_resolves_year_from_payment_date():
    withholding = paygw_weekly(150000, payment_date="2024-06-28", tax_free_threshold=True)
    assert withholding == 33417


def test_paygw_includes_stsl_when_requested():
    base = paygw_weekly(250000, financial_year="2024-25", tax_free_threshold=True, stsl=False)
    with_stsl = paygw_weekly(250000, financial_year="2024-25", tax_free_threshold=True, stsl=True)
    assert with_stsl > base
    assert with_stsl - base == 21250
