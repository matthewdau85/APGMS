from app.domains import payg_w
from app.rules.loader import load_payg_rules_index
from app.tax_rules import gst_line_tax


def test_payroll_and_pos_regression():
    rules = load_payg_rules_index()
    event = {
        "payg_w": {
            "method": "table_ato",
            "period": "fortnightly",
            "gross": 4800.0,
            "tax_free_threshold": True,
            "stsl": True,
            "financial_year": "2024-25",
        }
    }
    result = payg_w.compute(event, rules)
    assert result["withholding"] == 1565.69
    assert result["net"] == 3234.31

    pos_tax_exclusive = gst_line_tax(275000, "GST")
    pos_tax_inclusive = gst_line_tax(110000, "GST_INCLUSIVE")
    assert pos_tax_exclusive == 27500
    assert pos_tax_inclusive == 10000
    assert pos_tax_exclusive + pos_tax_inclusive == 37500
