from app.engines.paygw import compute_withholding
from app.engines.gst import compute_gst


def test_paygw_weekly_thresholds():
    cases = [
        (180_000, 36_285),
        (320_000, 82_512),
        (520_000, 168_881),
    ]
    for gross, expected in cases:
        result = compute_withholding({"gross": gross, "period": "weekly", "flags": {"tax_free_threshold": True}})
        assert result == expected


def test_paygw_monotonic():
    base = compute_withholding({"gross": 300_000, "period": "weekly", "flags": {"tax_free_threshold": True}})
    upper = compute_withholding({"gross": 301_000, "period": "weekly", "flags": {"tax_free_threshold": True}})
    assert upper >= base


def test_gst_summary():
    result = compute_gst({"abn": "12345678901", "periodId": "2025-09", "basis": "accrual"})
    assert result["payable"]["1A"] == 123_456
    assert result["credits"]["1B"] == 20_000
    assert result["labels"]["G1"] == 1_478_016
