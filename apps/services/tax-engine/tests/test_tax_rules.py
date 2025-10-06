from app.tax_rules import (
    gst_label_totals,
    gst_line_tax,
    paygw_label_totals,
    paygw_table_withholding,
    paygw_weekly,
)


def test_gst_line_tax_half_up():
    assert gst_line_tax(10000, "GST") == 1000
    assert gst_line_tax(5, "GST") == 1  # 0.5 cent -> rounds up to 1 cent
    assert gst_line_tax(4, "GST") == 0  # 0.4 cent -> stays at 0
    assert gst_line_tax(10000, "GST_FREE") == 0


def test_gst_cash_vs_accrual_rounding_difference():
    accrual_lines = [{"amount_cents": 5, "tax_code": "GST"} for _ in range(50)]
    cash_lines = []
    for _ in range(50):
        cash_lines.append({"amount_cents": 3, "tax_code": "GST"})
        cash_lines.append({"amount_cents": 2, "tax_code": "GST"})

    accrual_totals = gst_label_totals(accrual_lines)["1A"]
    cash_totals = gst_label_totals(cash_lines).get("1A", {"cents": 0, "label": 0})

    assert accrual_totals["cents"] == 50
    assert accrual_totals["label"] == 1
    assert cash_totals["cents"] == 0
    assert cash_totals["label"] == 0


def test_gst_label_whole_dollar_rounding_boundary():
    below = gst_label_totals([{"amount_cents": 5, "tax_code": "GST"} for _ in range(49)])["1A"]
    above = gst_label_totals([{"amount_cents": 5, "tax_code": "GST"} for _ in range(50)])["1A"]

    assert below["cents"] == 49
    assert below["label"] == 0
    assert above["cents"] == 50
    assert above["label"] == 1


def test_paygw_weekly_rounding_boundary():
    assert paygw_weekly(5) == 1
    assert paygw_weekly(3) == 0


def test_paygw_period_specific_rounding():
    weekly = paygw_weekly(12345)
    monthly = paygw_table_withholding(12345, period="monthly")
    assert weekly % 100 != 0  # cents precision per rounding spec
    assert monthly % 100 == 0  # whole dollars per monthly rounding rule


def test_paygw_label_rounding_to_whole_dollar():
    weekly_withholding = [paygw_weekly(5) for _ in range(50)]
    label = paygw_label_totals(weekly_withholding)
    assert label["cents"] == 50
    assert label["label"] == 1
