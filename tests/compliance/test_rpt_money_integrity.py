import pytest

from libs.rpt import rpt


def test_build_uses_integer_cents():
    token = rpt.build("2024Q4", 12345, 67890, {"src": "digest"}, 0.0, ttl_seconds=30)
    assert token["paygw_total_cents"] == 12345
    assert token["gst_total_cents"] == 67890


def test_float_inputs_rejected_by_default():
    with pytest.raises(TypeError):
        rpt.build("2024Q4", 100.0, 200.0, {"src": "digest"}, 0.0)


def test_float_inputs_can_be_flagged_on(monkeypatch):
    monkeypatch.setenv("APGMS_RPT_ALLOW_FLOAT_INPUTS", "1")
    token = rpt.build("2024Q4", 100.0, 200.0, {"src": "digest"}, 0.0)
    assert token["paygw_total_cents"] == 10_000
    assert token["gst_total_cents"] == 20_000
