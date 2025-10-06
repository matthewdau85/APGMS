from __future__ import annotations

import json
from pathlib import Path
from typing import List

import pytest
from fastapi.testclient import TestClient

from ml_assist.psi import calculate_psi
from ml_assist.service import create_app


@pytest.fixture(autouse=True)
def reset_feature_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FEATURE_ML", raising=False)
    monkeypatch.delenv("ML_OVERRIDE_STORE", raising=False)


def _build_client(monkeypatch: pytest.MonkeyPatch, tmp_path_factory: pytest.TempPathFactory) -> TestClient:
    tmp_path = tmp_path_factory.mktemp("ml_override") / "overrides.json"
    monkeypatch.setenv("FEATURE_ML", "true")
    monkeypatch.setenv("ML_OVERRIDE_STORE", str(tmp_path))
    return TestClient(create_app())


def test_recon_score_returns_advisory_with_override(monkeypatch: pytest.MonkeyPatch, tmp_path_factory: pytest.TempPathFactory) -> None:
    client = _build_client(monkeypatch, tmp_path_factory)
    payload = {
        "items": [
            {
                "item_id": "ITEM-123",
                "recon_delta": 425.0,
                "late_settlement_minutes": 180,
                "duplicate_crn": False,
                "user_override": "Escalated to tier 2",
            }
        ]
    }
    response = client.post("/ml/recon/score", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["results"][0]["tags"] == ["advisory"]
    assert body["results"][0]["requires_confirmation"] is True
    override_path = Path(client.app.state.override_store_path)
    override_file = json.loads(override_path.read_text(encoding="utf-8"))
    assert override_file["recon.score"]["ITEM-123"][0]["override"] == "Escalated to tier 2"


def test_forecast_respects_feature_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FEATURE_ML", "false")
    client = TestClient(create_app())
    payload = {
        "period": "2025-Q4",
        "history": [
            {"period": "2025-Q1", "liability": 1000.0},
            {"period": "2025-Q2", "liability": 1250.0},
            {"period": "2025-Q3", "liability": 1400.0},
        ],
    }
    response = client.post("/ml/forecast/liability", json=payload)
    assert response.status_code == 503


def test_calculate_psi_flags_drift() -> None:
    expected: List[float] = [10, 12, 11, 13, 12, 11, 15]
    actual_stable: List[float] = list(expected)
    actual_shifted: List[float] = [25, 24, 26, 23, 27, 28, 29]

    stable_score = calculate_psi(expected, actual_stable)
    drift_score = calculate_psi(expected, actual_shifted)

    assert stable_score < 0.1
    assert drift_score > 0.25
