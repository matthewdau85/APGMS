import json
from pathlib import Path

import pytest
from app.tax_rules import gst_line_tax, paygw_weekly

GOLDEN_DIR = Path(__file__).parent / "golden"


def load_golden(name: str):
    with open(GOLDEN_DIR / name, "r", encoding="utf-8") as fh:
        return json.load(fh)

@pytest.mark.parametrize("amount_cents, expected", [
    (0, 0),
    (1000, 100),   # 10% GST
    (999, 100),    # rounding check
])
def test_gst(amount_cents, expected):
    assert gst_line_tax(amount_cents, "GST") == expected

@pytest.mark.parametrize("gross, expected", [
    (50_000, 7_500),     # 15% below bracket
    (80_000, 12_000),    # top of bracket
    (100_000, 16_000),   # 12,000 + 20% of 20,000
])
def test_paygw(gross, expected):
    assert paygw_weekly(gross) == expected


def test_gst_golden_samples():
    for case in load_golden("gst_more_examples.json"):
        amount = case["amount_cents"]
        tax_code = case.get("tax_code", "GST")
        expected = case["expected"]
        assert gst_line_tax(amount, tax_code) == expected


def test_paygw_golden_samples():
    for case in load_golden("payg_more_examples.json"):
        gross = case["gross"]
        expected = case["expected"]
        assert paygw_weekly(gross) == expected
