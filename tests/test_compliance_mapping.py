import json
from pathlib import Path


def test_compliance_mapping_links_patent_controls():
    mapping_path = Path("schema/impl/compliance_mapping.json")
    payload = json.loads(mapping_path.read_text())
    entries = payload.get("compliance_mapping", [])
    assert entries, "compliance mapping should not be empty"
    controls = {entry["control"] for entry in entries}
    assert controls == {
        "CTRL_GATE_STATE_MACHINE",
        "CTRL_ONE_WAY_ACCOUNT_LOCK",
        "CTRL_RPT_DIGEST_SIGNING",
        "CTRL_AUDIT_HASH_CHAIN",
        "CTRL_POS_PAYROLL_DIGEST",
        "CTRL_ANOMALY_BLOCK",
    }
    assert all(entry["source"] == "Patent-APGMS" for entry in entries)
    assert all(entry["obligation"] for entry in entries)
