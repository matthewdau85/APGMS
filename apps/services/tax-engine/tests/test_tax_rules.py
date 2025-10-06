from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.tax_rules import gst_line_tax


@pytest.mark.parametrize(
    "amount_cents,tax_code,expected",
    [
        (0, "GST", 0),
        (10_000, "GST", 1_000),
        (10_000, "GST_FREE", 0),
        (10_000, "exempt", 0),
    ],
)
def test_gst_line_tax(amount_cents: int, tax_code: str, expected: int) -> None:
    assert gst_line_tax(amount_cents, tax_code) == expected


def test_payg_rules_metadata_contains_version() -> None:
    rules_path = Path(__file__).resolve().parents[2] / "app" / "rules" / "payg_w_2024_25.json"
    payload = json.loads(rules_path.read_text(encoding="utf-8-sig"))
    assert payload.get("version") == "2024-25"
    assert payload["formula_progressive"]["period"] == "weekly"
