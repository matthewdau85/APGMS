import json
from itertools import permutations

import pytest

from app import tax_rules
from app.domains import payg_w
from app.tax_rules import gst_invoice_totals


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


def test_paygw_monotonic_within_bracket(paygw_rules):
    brackets = paygw_rules["formula_progressive"]["brackets"]
    previous_up_to = 0.0
    for bracket in brackets:
        upper = float(bracket["up_to"])
        start = previous_up_to
        sample_limit = upper if upper < 10_000 else start + 200.0
        start_cents = int(round(start * 100))
        end_cents = int(round(sample_limit * 100))
        last = None
        for cents in range(start_cents + 1, end_cents + 1):
            gross = cents / 100
            current = _withholding_cents(gross, paygw_rules)
            if last is not None:
                assert current >= last, (
                    f"Withholding decreased within bracket: {gross:.2f} produced {current} < {last}"
                )
            last = current
        previous_up_to = upper


def test_gst_totals_invariant_under_line_shuffle():
    lines = [
        {"amount_cents": 12500, "tax_code": "GST"},
        {"amount_cents": 7600, "tax_code": "GST"},
        {"amount_cents": 3300, "tax_code": "GST_FREE"},
        {"amount_cents": 2400, "tax_code": "ZERO_RATED"},
    ]
    baseline = gst_invoice_totals(lines)
    for perm in permutations(lines):
        assert gst_invoice_totals(list(perm)) == baseline
