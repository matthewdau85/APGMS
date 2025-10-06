from decimal import Decimal

import pytest

from app.tax_rules import compute_withholding, gst_line_tax


@pytest.mark.parametrize(
    "amount_cents, tax_code, expected",
    [
        (0, "GST", 0),
        (110000, "GST", 10000),
        (55000, "GST", 5000),
        (33000, "GST_FREE", 0),
    ],
)
def test_gst_line_tax(amount_cents: int, tax_code: str, expected: int) -> None:
    assert gst_line_tax(amount_cents, tax_code) == expected


@pytest.mark.parametrize(
    "gross, expected",
    [
        (Decimal("500"), 8792),
        (Decimal("1200"), 32756),
        (Decimal("2500"), 82436),
    ],
)
def test_weekly_withholding_samples(gross: Decimal, expected: int) -> None:
    assert compute_withholding(gross, "weekly", "resident", {"tax_free_threshold": True}) == expected
