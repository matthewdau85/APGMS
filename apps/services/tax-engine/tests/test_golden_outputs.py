from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.domains import payg_w

RULES_PATH = Path(__file__).resolve().parents[2] / "app" / "rules" / "payg_w_2024_25.json"


@pytest.fixture(scope="module")
def weekly_rules() -> dict:
    return json.loads(RULES_PATH.read_text(encoding="utf-8-sig"))


@pytest.mark.parametrize(
    "gross,expected_withholding",
    [
        (300.0, 0.0),
        (450.0, 17.48),
        (700.0, 94.4),
        (900.0, 168.0),
    ],
)
def test_weekly_paygw_golden_outputs(
    weekly_rules: dict, gross: float, expected_withholding: float
) -> None:
    event = {"payg_w": {"method": "table_ato", "gross": gross, "period": "weekly"}}
    result = payg_w.compute(event, weekly_rules)
    assert result["withholding"] == pytest.approx(expected_withholding, rel=1e-3)
    assert result["net"] == pytest.approx(gross - expected_withholding, rel=1e-3)


@pytest.mark.parametrize(
    "gross,target_net",
    [
        (950.0, 800.0),
        (1200.0, 950.0),
    ],
)
def test_net_to_gross_solver_consistency(
    weekly_rules: dict, gross: float, target_net: float
) -> None:
    event = {
        "payg_w": {
            "method": "net_to_gross",
            "period": "weekly",
            "target_net": target_net,
        }
    }
    result = payg_w.compute(event, weekly_rules)
    assert result["method"] == "net_to_gross"
    assert result["net"] == pytest.approx(target_net, rel=1e-3)
    assert result["gross"] >= target_net
