import json
from pathlib import Path

import pytest

from app.domains import payg_w

RULES_PATH = Path(__file__).resolve().parent.parent / "app" / "rules" / "payg_w_2024_25.json"
PAYGW_RULES = json.loads(RULES_PATH.read_text(encoding="utf-8"))


def _compute(period: str, gross: float, *, tax_free_threshold: bool = True, stsl: bool = False, medicare: str = "standard"):
    event = {
        "payg_w": {
            "method": "table_ato",
            "period": period,
            "gross": gross,
            "tax_free_threshold": tax_free_threshold,
            "stsl": stsl,
            "medicare_variation": medicare,
        }
    }
    return payg_w.compute(event, PAYGW_RULES)


def test_weekly_standard_matches_ato_example():
    """Weekly example from NAT 1004 (2024-25): $1,500 with tax-free threshold claimed."""
    result = _compute("weekly", 1500.0)
    assert pytest.approx(302.85, abs=0.01) == result["withholding"]
    assert pytest.approx(1197.15, abs=0.01) == result["net"]


def test_fortnightly_with_stsl():
    """Fortnightly example applying STSL repayment and standard Medicare levy."""
    result = _compute("fortnightly", 3200.0, stsl=True)
    assert pytest.approx(813.69, abs=0.01) == result["withholding"]
    assert pytest.approx(2386.31, abs=0.01) == result["net"]


def test_monthly_medicare_exempt():
    """Monthly example with Medicare exemption (variation 2)."""
    result = _compute("monthly", 7500.0, medicare="exempt")
    assert pytest.approx(1482.33, abs=0.01) == result["withholding"]
    assert pytest.approx(6017.67, abs=0.01) == result["net"]


def test_no_tax_free_threshold_increases_withholding():
    weekly_tft = _compute("weekly", 1500.0)
    weekly_no_tft = _compute("weekly", 1500.0, tax_free_threshold=False)
    assert weekly_no_tft["withholding"] > weekly_tft["withholding"]
    assert pytest.approx(358.85, abs=0.01) == weekly_no_tft["withholding"]
