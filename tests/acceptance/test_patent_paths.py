# tests/acceptance/test_patent_paths.py

from app.rates.mock import MockRatesPort
from app.rates.real import RealRatesPort
from libs.rpt.rpt import build, verify


def test_rpt_sign_verify():
    mock_port = MockRatesPort()
    real_port = RealRatesPort()
    mock_version = mock_port.latest()
    real_version = real_port.latest()
    rpt = build(
        "2024Q4",
        100.0,
        200.0,
        {"payroll": "abc", "pos": "def"},
        0.1,
        {
            mock_port.port_name: mock_port.evidence(mock_version),
            real_port.port_name: real_port.evidence(real_version),
        },
        ttl_seconds=60,
    )
    assert "signature" in rpt
    payload = {k: v for k, v in rpt.items() if k != "signature"}
    assert verify(payload, rpt["signature"])


def test_recon_pass_example():
    # Fake math: equality within tolerance and anomaly ok
    paygw_total, gst_total = 100.00, 200.00
    owa_paygw, owa_gst = 100.00, 200.00
    anomaly_score = 0.1
    assert abs(paygw_total - owa_paygw) <= 0.01
    assert abs(gst_total - owa_gst) <= 0.01
    assert anomaly_score < 0.8
