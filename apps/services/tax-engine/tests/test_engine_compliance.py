import pathlib
import sys
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[2] / "tax-engine"
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from app.domains import gst, payg_w  # noqa: E402
from app.domains.storage import clear as storage_clear, set_period_data  # noqa: E402
from app.rules import load_paygw_rules, segments_for_period  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def reset_storage():
    storage_clear()
    yield
    storage_clear()


@pytest.fixture(scope="module")
def paygw_rules():
    return load_paygw_rules("payg_w_2024_25.json")


def test_paygw_weekly_boundaries(paygw_rules):
    examples = [
        (350, Decimal("0.00")),
        (359, Decimal("0.00")),
        (400, Decimal("7.79")),
        (438, Decimal("15.01")),
        (500, Decimal("29.52")),
        (721, Decimal("100.78")),
        (865, Decimal("150.46")),
        (1000, Decimal("203.11")),
    ]
    for gross, expected in examples:
        result = payg_w.compute(
            {"payg_w": {"gross": gross, "period": "weekly", "residency": "resident", "tax_free_threshold": True}},
            paygw_rules,
        )
        assert Decimal(str(result["withholding"])) == expected


def test_paygw_monotonic_within_bracket(paygw_rules):
    low, high = 438, 548
    prev = Decimal("0")
    for gross in range(low, high):
        result = payg_w.compute(
            {"payg_w": {"gross": gross, "period": "weekly", "residency": "resident", "tax_free_threshold": True}},
            paygw_rules,
        )
        current = Decimal(str(result["withholding"]))
        assert current >= prev
        prev = current


def test_gst_cash_vs_accrual_attribution():
    start = date(2025, 7, 1)
    end = date(2025, 9, 30)
    segments, _ = segments_for_period(start, end)
    segment = segments[0]
    gst_payload = {
        "transactions": [
            {
                "category": "sale",
                "taxable_value": 5000,
                "gst": 500,
                "invoice_date": "2025-07-10",
                "payment_date": "2025-07-15",
            },
            {
                "category": "sale",
                "taxable_value": 8000,
                "gst": 800,
                "invoice_date": "2025-08-30",
                "payment_date": "2025-10-05",
            },
        ],
        "adjustments": [
            {
                "type": "decreasing",
                "label": "1A",
                "amount": 100,
                "trigger": "bad_debt",
                "effective_date": "2025-08-20",
            }
        ],
        "imports": [
            {"id": "dgst-1", "gst": 600, "deferral_date": "2025-08-21"}
        ],
        "wet": [{"amount": 200, "effective_date": "2025-07-12"}],
        "lct": [{"amount": 300, "effective_date": "2025-07-15"}],
    }

    accrual = gst.compute_segment(gst_payload, "accrual", segment.effective_from, segment.to)
    cash = gst.compute_segment(gst_payload, "cash", segment.effective_from, segment.to)

    assert accrual["labels"]["1A"] == Decimal("1800.00")
    assert cash["labels"]["1A"] == Decimal("1000.00")
    assert accrual["labels"]["7"] == Decimal("600.00")
    assert accrual["labels"]["7"] == cash["labels"]["7"]


def test_tax_totals_endpoint_segments(paygw_rules):
    client = TestClient(app)
    period_data = {
        "period": {"start": "2025-07-01", "end": "2025-09-30", "gst_basis": "accrual"},
        "gst": {
            "basis": "accrual",
            "transactions": [
                {
                    "category": "sale",
                    "taxable_value": 5000,
                    "gst": 500,
                    "invoice_date": "2025-07-10",
                    "payment_date": "2025-07-15",
                },
                {
                    "category": "sale",
                    "taxable_value": 8000,
                    "gst": 800,
                    "invoice_date": "2025-08-30",
                    "payment_date": "2025-09-02",
                },
            ],
            "imports": [
                {"id": "dgst-1", "gst": 600, "deferral_date": "2025-08-21"}
            ],
            "adjustments": [
                {
                    "type": "decreasing",
                    "label": "1A",
                    "amount": 100,
                    "trigger": "price_change",
                    "effective_date": "2025-08-25",
                }
            ],
            "wet": [{"amount": 400, "effective_date": "2025-07-20"}],
            "lct": [{"amount": 500, "effective_date": "2025-09-05"}],
        },
        "paygw": {
            "payruns": [
                {
                    "date": "2025-07-18",
                    "gross": 1200,
                    "period": "weekly",
                    "residency": "resident",
                    "tax_free_threshold": True,
                },
                {
                    "date": "2025-09-15",
                    "gross": 1300,
                    "period": "weekly",
                    "residency": "resident",
                    "tax_free_threshold": True,
                },
            ]
        },
        "paygi": {
            "method": "instalment_rate",
            "instalment_income": 60000,
            "instalment_rate": 5.0,
            "effective_date": "2025-09-10",
            "variation": {"estimate": 4500, "reason": "cash flow", "safe_harbour": True},
        },
    }

    abn = "12345678901"
    period_id = "2025-09"
    set_period_data(abn, period_id, period_data)

    response = client.get(f"/tax/{abn}/{period_id}/totals")
    assert response.status_code == 200
    payload = response.json()
    assert payload["rates_version"] == "2025.1"
    assert len(payload["segments"]) == 2

    total_labels = payload["labels"]
    assert pytest.approx(total_labels["1A"], rel=1e-6) == 1800.0
    assert pytest.approx(total_labels["7"], rel=1e-6) == 600.0
    assert "W1" in total_labels and total_labels["W1"] > 0

    first_segment, second_segment = payload["segments"]
    assert first_segment["paygi"] is None
    assert second_segment["paygi"]["method"] == "instalment_rate"
    assert second_segment["effective_from"] == "2025-09-01"
    assert second_segment["labels"]["T3"] > 0
