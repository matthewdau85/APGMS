import os
import time
import pytest
import nacl.signing

try:
    from apgms_sdk.rpt import issue_rpt, verify_rpt, introspect
except ModuleNotFoundError:  # pragma: no cover - optional dependency
    pytest.skip("apgms_sdk not installed", allow_module_level=True)


def test_issue_verify_replay():
    sk = nacl.signing.SigningKey.generate()
    payload = {
        "entity_id": "ent-1",
        "period_id": "2025-09",
        "tax_type": "GST",
        "amount_cents": 12345,
        "merkle_root": "00" * 32,
        "running_balance_hash": "11" * 32,
        "anomaly_vector": {"variance_ratio": 0.9},
        "thresholds": {"variance_ratio": 1.5},
        "rail_id": "EFT",
        "destination_id": "ATO-PRN-TEST",
        "expiry_ts": int(time.time()) + 60,
        "reference": "RPT-1",
        "nonce": os.urandom(8).hex(),
    }
    tok = issue_rpt(payload, bytes(sk))
    seen = set()
    assert verify_rpt(tok, seen)
    assert not verify_rpt(tok, seen)  # replay blocked
    info = introspect(tok)
    assert info["tax_type"] == "GST"
