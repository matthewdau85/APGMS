from fastapi.testclient import TestClient

from app.engine import compute_tax_event, resolve_period_bounds
from app.rules.loader import build_rules_version_payload, load_rule_documents
from app.main import app


def test_resolve_period_bounds_month():
    start, end = resolve_period_bounds("2025-09")
    assert start == "2025-09-01"
    assert end == "2025-09-30"


def test_resolve_period_bounds_fbt():
    start, end = resolve_period_bounds("2025-FBT")
    assert start == "2024-04-01"
    assert end == "2025-03-31"


def test_compute_tax_event_segments_include_sha():
    event = {"id": "test", "entity": "AUS-PTY", "period": "2025-09", "payg_w": {"method": "formula_progressive", "period": "weekly", "gross": 2000}}
    result = compute_tax_event(event)
    segments = result["evidence"]["segments"]
    assert segments, "Expected at least one evidence segment"
    rule_docs = load_rule_documents()
    expected_shas = {doc.sha256 for name, doc in rule_docs.items() if name.startswith("payg_w")}
    for segment in segments:
        assert segment["rules_sha256"] in expected_shas
        assert segment["effective_from"] <= segment["effective_to"]


def test_rules_version_endpoint_matches_loader():
    client = TestClient(app)
    resp = client.get("/rules/version")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload == build_rules_version_payload()
