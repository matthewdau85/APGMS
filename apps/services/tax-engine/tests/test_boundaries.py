import json

import pytest

from app import tax_rules
from app.domains import payg_w


@pytest.fixture(scope="module")
def paygw_rules():
    with tax_rules.rules_path("payg_w_2024_25.json").open("r", encoding="utf-8-sig") as fh:
        return json.load(fh)


def _withholding_cents(gross: float, rules: dict) -> int:
    outcome = payg_w.compute(
        {"payg_w": {"method": "formula_progressive", "period": "weekly", "gross": gross}},
        rules,
    )
    return int(round(float(outcome["withholding"]) * 100))


def test_paygw_bracket_thresholds(paygw_rules):
    brackets = paygw_rules["formula_progressive"]["brackets"]
    thresholds = [float(bracket["up_to"]) for bracket in brackets[:-1]]
    previous_lower = 0.0
    for threshold in thresholds:
        below = max(previous_lower + 0.01, round(threshold - 0.01, 2))
        at = round(threshold, 2)
        above = round(threshold + 0.01, 2)
        samples = [below, at, above]
        values = [_withholding_cents(gross, paygw_rules) for gross in samples]
        spread = max(values) - min(values)
        assert spread <= 500, (
            f"Withholding changed by more than $5.00 around threshold {threshold}: "
            f"{list(zip(samples, values))}"
        )
        previous_lower = threshold


def test_paygw_last_bracket_progression(paygw_rules):
    start = float(paygw_rules["formula_progressive"]["brackets"][-2]["up_to"])
    samples = [start + offset for offset in (0.01, 100.00, 200.00)]
    values = [_withholding_cents(gross, paygw_rules) for gross in samples]
    assert values == sorted(values), (
        "Top bracket withholding should increase with gross income: "
        f"{list(zip(samples, values))}"
    )
