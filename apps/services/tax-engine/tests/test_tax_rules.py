from app.tax_rules import gst_line_tax, paygw_weekly


def test_gst_sale_and_purchase():
    sale_cents = 110000  # $1,100
    purchase_cents = 55000  # $550
    assert gst_line_tax(sale_cents, "GST") == 11000
    assert gst_line_tax(purchase_cents, "GST", kind="purchase") == -5500


def test_paygw_weekly_samples():
    weekly_gross_cents = 150000  # $1,500
    assert paygw_weekly(weekly_gross_cents, tax_free_threshold=True) == 27285
    assert paygw_weekly(weekly_gross_cents, tax_free_threshold=False) == 34231


def test_paygw_weekly_with_stsl():
    gross_cents = 300000  # $3,000 fortnight equivalent weekly doubling to compare to sample
    withholding_tft = paygw_weekly(gross_cents, tax_free_threshold=True, stsl=False)
    withholding_with_stsl = paygw_weekly(gross_cents, tax_free_threshold=True, stsl=True)
    assert withholding_with_stsl > withholding_tft
