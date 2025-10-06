from __future__ import annotations

from decimal import Decimal
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TAX_ENGINE = ROOT / "apps" / "services" / "tax-engine"
if str(TAX_ENGINE) not in sys.path:
    sys.path.insert(0, str(TAX_ENGINE))

from app.schedules import payg_withholding  # type: ignore  # noqa: E402


def test_weekly_resident_thresholds():
    assert payg_withholding("weekly", True, "resident", [], 359) == 0
    assert payg_withholding("weekly", True, "resident", [], 438) == 15
    assert payg_withholding("weekly", True, "resident", [], 548) == 40
    assert payg_withholding("weekly", False, "resident", [], 600) == 282


def test_monthly_resident_and_fortnightly_non_resident():
    assert payg_withholding("monthly", True, "resident", [], Decimal("2374.67")) == 175
    assert payg_withholding("fortnightly", True, "non_resident", [], 420) == 111


def test_quarterly_with_stsl():
    # High income should accrue STSL repayments on top of PAYG withholding.
    base = payg_withholding("quarterly", True, "resident", [], 20000)
    with_stsl = payg_withholding("quarterly", True, "resident", ["HELP"], 20000)
    assert with_stsl > base
    assert with_stsl - base >= 80
