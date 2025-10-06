import json
from pathlib import Path

import pytest

from app.domains import payg_w
from app import tax_rules
from app.tax_rules import (
    fbt_liability,
    gst_invoice_totals,
    paygi_instalment,
    payroll_tax_liability,
    sg_quarterly_obligation,
)


def _repo_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / ".git").exists():
            return parent
    raise RuntimeError("Repository root with .git not found")


GOLDENS_DIR = _repo_root() / "tests" / "goldens"
GOLDEN_CASES = sorted(GOLDENS_DIR.rglob("*.json"))


@pytest.mark.parametrize(
    "golden_path",
    GOLDEN_CASES,
    ids=lambda p: str(p.relative_to(GOLDENS_DIR)),
)
def test_goldens(golden_path: Path) -> None:
    data = json.loads(golden_path.read_text(encoding="utf-8"))
    regime = data["regime"]
    payload = data["payload"]
    expected = data["expected"]

    if regime == "gst":
        result = gst_invoice_totals(payload["lines"])
        assert result == expected
        return

    if regime == "paygw":
        with tax_rules.rules_path("payg_w_2024_25.json").open("r", encoding="utf-8-sig") as fh:
            rules = json.load(fh)
        outcome = payg_w.compute({"payg_w": payload}, rules)
        withholding_cents = int(round(float(outcome["withholding"]) * 100))
        assert withholding_cents == expected["withholding_cents"]
        return

    if regime == "paygi":
        liability = paygi_instalment(**payload)
        assert liability == expected["instalment_cents"]
        return

    if regime == "sg":
        contribution = sg_quarterly_obligation(**payload)
        assert contribution == expected["contribution_cents"]
        return

    if regime == "fbt":
        liability = fbt_liability(**payload)
        assert liability == expected["fbt_cents"]
        return

    if regime == "payroll_tax":
        liability = payroll_tax_liability(**payload)
        assert liability == expected["tax_cents"]
        return

    pytest.fail(f"Unknown regime in golden case: {regime}")
