import pytest

from app.engines.paygw import compute_withholding
from app.engines.gst import compute_gst

@pytest.mark.parametrize("amount_cents, expected", [
    (0, 0),
    (100_000, 20_000),
    (250_000, 50_000),
])
def test_gst(amount_cents, expected):
    result = compute_gst({
        "abn": "demo",
        "periodId": "demo",
        "basis": "accrual",
        "sales": [{"net_cents": amount_cents, "tax_code": "GST"}],
    })
    assert result["payable"]["1A"] == expected


@pytest.mark.parametrize("gross, expected", [
    (180_000, 36_285),
    (320_000, 82_512),
    (520_000, 168_881),
])
def test_paygw(gross, expected):
    assert compute_withholding({"gross": gross, "period": "weekly", "flags": {"tax_free_threshold": True}}) == expected
