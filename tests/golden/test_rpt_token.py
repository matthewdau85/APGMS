import json
from pathlib import Path

from libs.rpt import rpt


def test_rpt_build_matches_golden(monkeypatch):
    monkeypatch.setenv("APGMS_RPT_SECRET", "golden-secret")

    def fake_time():
        return 1_700_000_000

    def fake_urandom(length: int) -> bytes:
        return bytes(range(1, length + 1))

    monkeypatch.setattr(rpt.time, "time", fake_time)
    monkeypatch.setattr(rpt.os, "urandom", fake_urandom)

    actual = rpt.build(
        period_id="2025Q1",
        paygw_total=12345,
        gst_total=67890,
        source_digests={"payroll": "abc123", "pos": "xyz789"},
        anomaly_score=0,
        ttl_seconds=900,
    )

    golden_path = Path(__file__).with_name("rpt_token.json")
    expected = json.loads(golden_path.read_text(encoding="utf-8"))
    assert actual == expected
