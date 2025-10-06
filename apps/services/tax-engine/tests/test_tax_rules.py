from decimal import Decimal

import pytest

from app.data_store import load_period_payload
from app.services.gst import compute_gst
from app.services.paygw import compute_withholding


@pytest.mark.parametrize(
    "gross,period,residency,flags,expected_withheld",
    [
        (1538.46, "weekly", "resident", {"tax_free_threshold": True}, 284),
        (4615.38, "fortnightly", "resident", {"tax_free_threshold": True, "stsl": True}, 1400),
    ],
)
def test_paygw_golden_examples(gross, period, residency, flags, expected_withheld):
    result = compute_withholding(gross, period, residency, flags)
    assert result.withheld == expected_withheld
    assert pytest.approx(result.net, rel=1e-4) == round(gross - expected_withheld, 2)


def test_withholding_monotonic_across_bracket():
    incomes = [1200 + step for step in range(0, 201, 20)]
    previous = -1
    for gross in incomes:
        result = compute_withholding(gross, "weekly", "resident", {"tax_free_threshold": True})
        assert result.withheld >= previous
        previous = result.withheld


@pytest.mark.parametrize("annual_threshold", [18200, 45000, 135000, 190000])
def test_withholding_bracket_boundaries(annual_threshold):
    weekly_factor = Decimal("52")
    base = Decimal(str(annual_threshold)) / weekly_factor
    below = (Decimal(str(annual_threshold)) - Decimal("0.01")) / weekly_factor
    above = (Decimal(str(annual_threshold)) + Decimal("0.01")) / weekly_factor

    below_result = compute_withholding(float(below), "weekly", "resident", {"tax_free_threshold": True})
    above_result = compute_withholding(float(above), "weekly", "resident", {"tax_free_threshold": True})
    assert above_result.withheld >= below_result.withheld


def test_gst_totals_match_expected_labels():
    payload = load_period_payload("12345678901", "2025-09")
    totals = compute_gst("2025-09", payload["transactions"])
    assert totals.totals["sales_gross"] == pytest.approx(1980.0)
    assert totals.totals["sales_taxable"] == pytest.approx(1500.0)
    assert totals.totals["purchases_creditable"] == pytest.approx(700.0)
    assert totals.labels["1A"] == pytest.approx(150.0)
    assert totals.labels["1B"] == pytest.approx(70.0)


def test_period_totals_endpoint(client):
    response = client.get("/tax/12345678901/2025-09/totals")
    assert response.status_code == 200
    data = response.json()
    assert data["rates_version"] == "2024-25.v1"
    assert data["W1"] == pytest.approx(6154.0)
    assert data["W2"] == pytest.approx(1684.0)
    assert data["labels"]["1A"] == pytest.approx(150.0)
    assert data["labels"]["1B"] == pytest.approx(70.0)


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from app.main import app

    return TestClient(app)
