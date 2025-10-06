import json
from decimal import Decimal
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]


def load_json(path: Path):
    with path.open("r", encoding="utf-8-sig") as fh:
        return json.load(fh)


def test_gst_rate_constant():
    module_globals = {}
    gst_module = ROOT / "apps" / "services" / "tax-engine" / "app" / "tax_rules.py"
    exec(gst_module.read_text(encoding="utf-8"), module_globals)
    assert Decimal(str(module_globals["GST_RATE"])) == Decimal("0.10")


def test_payg_weekly_progressive_brackets():
    data = load_json(ROOT / "apps" / "services" / "tax-engine" / "app" / "rules" / "payg_w_2024_25.json")

    assert data["version"] == "2024-25"
    assert data["formula_progressive"]["period"] == "weekly"
    assert data["formula_progressive"]["tax_free_threshold"] is True
    assert data["formula_progressive"]["rounding"] == "HALF_UP"

    expected_brackets = [
        {"up_to": Decimal("359.00"), "a": Decimal("0.00"), "b": Decimal("0.0"), "fixed": Decimal("0.0")},
        {"up_to": Decimal("438.00"), "a": Decimal("0.19"), "b": Decimal("68.0"), "fixed": Decimal("0.0")},
        {"up_to": Decimal("548.00"), "a": Decimal("0.234"), "b": Decimal("87.82"), "fixed": Decimal("0.0")},
        {"up_to": Decimal("721.00"), "a": Decimal("0.347"), "b": Decimal("148.50"), "fixed": Decimal("0.0")},
        {"up_to": Decimal("865.00"), "a": Decimal("0.345"), "b": Decimal("147.0"), "fixed": Decimal("0.0")},
        {"up_to": Decimal("999999.0"), "a": Decimal("0.39"), "b": Decimal("183.0"), "fixed": Decimal("0.0")},
    ]

    actual_brackets = data["formula_progressive"]["brackets"]

    assert len(actual_brackets) == len(expected_brackets)

    for actual, expected in zip(actual_brackets, expected_brackets):
        for key, expected_value in expected.items():
            actual_value = Decimal(str(actual[key]))
            assert actual_value == expected_value, f"Mismatch for {key}: expected {expected_value}, got {actual_value}"


@pytest.mark.parametrize(
    "method",
    ["table_ato", "formula_progressive", "percent_simple", "flat_plus_percent", "bonus_marginal", "net_to_gross"],
)
def test_methods_enabled(method):
    data = load_json(ROOT / "apps" / "services" / "tax-engine" / "app" / "rules" / "payg_w_2024_25.json")
    assert method in data["methods_enabled"], f"{method} should remain enabled"
