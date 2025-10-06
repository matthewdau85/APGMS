from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.tax_rules import compute_gst, compute_withholding


@pytest.mark.parametrize(
    "gross, expected_cents",
    [
        (Decimal("500"), 8792),
        (Decimal("1200"), 32756),
        (Decimal("2500"), 82436),
    ],
)
def test_compute_withholding_weekly_golden(gross: Decimal, expected_cents: int) -> None:
    result = compute_withholding(gross, "weekly", "resident", {"tax_free_threshold": True})
    assert result == expected_cents


def test_withholding_monotonic_within_bracket() -> None:
    amounts = [Decimal(i) / 100 for i in range(8800, 37101, 50)]
    previous = None
    for gross in amounts:
        result = compute_withholding(gross, "weekly", "resident", {"tax_free_threshold": True})
        if previous is not None:
            assert previous <= result
        previous = result


def test_compute_gst_purchase_credit() -> None:
    transactions = [
        {"type": "purchase", "total_cents": 55000, "tax_code": "GST", "recognised": ["cash", "accrual"]},
        {"type": "purchase", "total_cents": 33000, "tax_code": "GST_FREE", "recognised": ["cash"]},
    ]
    result = compute_gst("2025-09", "cash", transactions)
    assert result["1B"] == 5000
    assert result["labels"]["G11"] == 83000


def test_get_totals_endpoint_uses_manifest_version() -> None:
    client = TestClient(app)
    response = client.get("/tax/12345678901/2025-09/totals", params={"basis": "cash"})
    assert response.status_code == 200
    data = response.json()
    assert data["W1"] == 430000
    assert data["W2"] == 137572
    assert data["1A"] == 30000
    assert data["1B"] == 5000
    assert data["rates_version"]
    assert data["labels"]["G1"] == 330000
    assert data["labels"]["W1"] == 430000
    assert data["labels"]["W2"] == 137572
