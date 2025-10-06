import json
from decimal import Decimal

from app.schedules import payg_withholding

with open("apps/services/tax-engine/app/rules/payg_w_2024_25.json", "r", encoding="utf-8") as f:
    PAYG_RULES = json.load(f)


def test_weekly_threshold_brackets():
    assert payg_withholding(Decimal("350"), period="weekly", tax_free_threshold=True, stsl=False, rules=PAYG_RULES) == Decimal("0")
    assert payg_withholding(Decimal("700"), period="weekly", tax_free_threshold=True, stsl=False, rules=PAYG_RULES) == Decimal("56")
    assert payg_withholding(Decimal("1200"), period="weekly", tax_free_threshold=True, stsl=False, rules=PAYG_RULES) == Decimal("183")
    assert payg_withholding(Decimal("2600"), period="weekly", tax_free_threshold=True, stsl=False, rules=PAYG_RULES) == Decimal("603")


def test_period_variants():
    fortnight = payg_withholding(Decimal("1400"), period="fortnightly", tax_free_threshold=True, stsl=False, rules=PAYG_RULES)
    assert fortnight == Decimal("112")
    no_tft = payg_withholding(Decimal("2400"), period="fortnightly", tax_free_threshold=False, stsl=False, rules=PAYG_RULES)
    assert no_tft == Decimal("478")
    monthly = payg_withholding(Decimal("6000"), period="monthly", tax_free_threshold=True, stsl=False, rules=PAYG_RULES)
    assert monthly == Decimal("1032")


def test_stsl_addition():
    base = payg_withholding(Decimal("6000"), period="monthly", tax_free_threshold=True, stsl=False, rules=PAYG_RULES)
    with_stsl = payg_withholding(Decimal("6000"), period="monthly", tax_free_threshold=True, stsl=True, rules=PAYG_RULES)
    assert with_stsl - base == Decimal("210")
