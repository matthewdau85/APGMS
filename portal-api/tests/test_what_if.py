import importlib.util
import pathlib

import pytest
from fastapi.testclient import TestClient

PORTAL_APP_PATH = pathlib.Path(__file__).resolve().parents[1] / "app.py"
spec = importlib.util.spec_from_file_location("portal_api_app", PORTAL_APP_PATH)
portal_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(portal_module)  # type: ignore[attr-defined]

app = portal_module.app
_LEDGER_STUB = portal_module._LEDGER_STUB

client = TestClient(app)


def test_paygi_variation_preview_keeps_ledger_pristine():
    payload = {
        "baseline_installment": 1500.0,
        "installments_paid": 2,
        "credits_to_date": 5000.0,
        "estimated_year_tax": 42000.0,
        "remaining_installments": 2,
        "target_percentage": 0.85,
    }
    before_entries = list(_LEDGER_STUB["entries"])

    resp = client.post("/what-if/paygi-variation", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert pytest.approx(data["recommended_installment"], rel=1e-6) == 13850.0
    assert data["ledger_impact"] == "none"
    assert data["ledger_snapshot"] == len(before_entries)
    assert _LEDGER_STUB["entries"] == before_entries


def test_rates_change_preview_segments_and_deltas():
    payload = {
        "annual_taxable_income": 120_000.0,
        "pay_frequency": "monthly",
        "period_start": "2025-06-01",
        "period_end": "2025-09-30",
        "change_effective": "2025-07-01",
        "current_version": "2024-25",
        "next_version": "2025-26",
    }

    resp = client.post("/what-if/rates-change", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert pytest.approx(data["annual"]["current"], rel=1e-6) == 26_788.0
    assert pytest.approx(data["annual"]["upcoming"], rel=1e-6) == 24_750.0
    assert pytest.approx(data["per_period"]["delta"], rel=1e-4) == -169.8333333333

    segments = data["segments"]
    assert len(segments) == 2
    assert {seg["rates_version"] for seg in segments} == {"2024-25", "2025-26"}
    assert data["ledger_snapshot"] == 0
    assert data["ledger_impact"] == "none"
