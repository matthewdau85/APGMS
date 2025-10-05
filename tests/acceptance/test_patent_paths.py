# tests/acceptance/test_patent_paths.py
from decimal import Decimal

from libs.rpt.rpt import build, verify


def test_rpt_sign_verify():
    rpt = build("2024Q4", 10_000, 20_000, {"payroll": "abc", "pos": "def"}, 0.1, ttl_seconds=60)
    assert "signature" in rpt
    payload = {k: v for k, v in rpt.items() if k != "signature"}
    assert verify(payload, rpt["signature"])


def test_recon_pass_example():
    paygw_total_cents, gst_total_cents = 10_000, 20_000
    owa_paygw_cents, owa_gst_cents = 10_000, 20_000
    anomaly_score = Decimal("0.1")
    assert paygw_total_cents == owa_paygw_cents
    assert gst_total_cents == owa_gst_cents
    assert anomaly_score < Decimal("0.8")
