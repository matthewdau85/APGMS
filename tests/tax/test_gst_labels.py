import json
from decimal import Decimal

from app.schedules import gst_labels

with open("apps/services/tax-engine/app/rules/gst_rates_2000_current.json", "r", encoding="utf-8") as f:
    GST_RULES = json.load(f)


def test_gst_label_aggregation():
    lines = [
        {"amount": Decimal("1100.00"), "tax_code": "GST", "kind": "sale"},
        {"amount": Decimal("2000.00"), "tax_code": "GST_FREE", "kind": "sale"},
        {"amount": Decimal("500.00"), "tax_code": "ZERO_RATED", "kind": "sale"},
        {"amount": Decimal("550.00"), "tax_code": "GST", "kind": "purchase", "capital": True},
        {"amount": Decimal("330.00"), "tax_code": "GST", "kind": "purchase", "capital": False},
    ]
    totals = gst_labels(lines, GST_RULES)
    assert totals["G1"] == Decimal("3600")
    assert totals["G2"] == Decimal("500")
    assert totals["G3"] == Decimal("2000")
    assert totals["1A"] == Decimal("100")
    assert totals["G10"] == Decimal("550")
    assert totals["G11"] == Decimal("330")
    assert totals["1B"] == Decimal("80")
