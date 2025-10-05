import json
import os

from app.domains import payg_w

RULES_PATH = os.path.join(os.path.dirname(__file__), "../app/rules/payg_w_2024_25.json")
with open(os.path.abspath(RULES_PATH), "r", encoding="utf-8") as f:
    RULES = json.load(f)


def test_weekly_table_matches_reference():
    event = {
        "payg_w": {
            "method": "table_ato",
            "period": "weekly",
            "gross": 1500.0,
            "tax_free_threshold": True,
            "stsl": False,
        }
    }
    result = payg_w.compute(event, RULES)
    assert result["withholding"] == 272.85
    assert "discrepancies" not in result


def test_weekly_no_threshold_matches_reference():
    event = {
        "payg_w": {
            "method": "table_ato",
            "period": "weekly",
            "gross": 1500.0,
            "tax_free_threshold": False,
            "stsl": False,
        }
    }
    result = payg_w.compute(event, RULES)
    assert result["withholding"] == 342.31


def test_fortnightly_with_stsl_matches_reference():
    event = {
        "payg_w": {
            "method": "table_ato",
            "period": "fortnightly",
            "gross": 3000.0,
            "tax_free_threshold": True,
            "stsl": True,
        }
    }
    result = payg_w.compute(event, RULES)
    assert abs(result["withholding"] - 665.69) < 0.01
