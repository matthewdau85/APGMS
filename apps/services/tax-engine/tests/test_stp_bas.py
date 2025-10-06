from __future__ import annotations

import pytest

from app.domains.stp_bas import ReconciliationError, STPEvent, rollup_stp_to_bas


def sample_events():
    return [
        {
            "stp_event_id": "EVT-001",
            "employee_id": "EMP-001",
            "earnings_code": "REG",
            "gross_cents": 1_500_00,
            "tax_withheld_cents": 450_00,
        },
        {
            "stp_event_id": "EVT-002",
            "employee_id": "EMP-001",
            "earnings_code": "BACKPAY",
            "gross_cents": 200_00,
            "tax_withheld_cents": 60_00,
        },
        {
            "stp_event_id": "EVT-003",
            "employee_id": "EMP-002",
            "earnings_code": "ALLOWANCE",
            "gross_cents": 50_00,
            "tax_withheld_cents": 10_00,
        },
        {
            "stp_event_id": "EVT-004",
            "employee_id": "EMP-003",
            "earnings_code": "ETP-R",
            "gross_cents": 1_200_00,
            "tax_withheld_cents": 180_00,
        },
    ]


def test_rollup_generates_totals_and_traceability():
    expected_bas = {"W1": 1_750_00, "W2": 700_00}
    result = rollup_stp_to_bas(sample_events(), expected_bas)

    w1 = result["bas_labels"]["W1"]
    w2 = result["bas_labels"]["W2"]

    assert w1["total_cents"] == 1_750_00
    assert w1["stp_event_ids"] == ["EVT-001", "EVT-002", "EVT-003"]
    assert {evt["earnings_code"] for evt in w1["events"]} == {"REG", "BACKPAY", "ALLOWANCE"}

    assert w2["total_cents"] == 700_00
    assert w2["stp_event_ids"] == ["EVT-001", "EVT-002", "EVT-003", "EVT-004"]

    assert result["special_events"]["back_payments"][0]["stp_event_id"] == "EVT-002"
    assert result["special_events"]["etp"][0]["stp_event_id"] == "EVT-004"

    recon_row = result["recon_inputs"][0]
    assert recon_row == {
        "stp_event_id": "EVT-001",
        "employee_id": "EMP-001",
        "earnings_code": "REG",
        "w1_cents": 1_500_00,
        "w2_cents": 450_00,
        "special_tags": [],
    }

    assert result["reconciliation"]["ok"] is True


def test_rollup_detects_mismatch():
    with pytest.raises(ReconciliationError) as exc:
        rollup_stp_to_bas(sample_events(), {"W1": 1})
    assert exc.value.reconciliation["W1"]["difference_cents"] == 1_750_00 - 1


def test_stp_event_from_raw_normalises_codes():
    ev = STPEvent.from_raw(
        {
            "stp_event_id": "id",
            "employee_id": "emp",
            "earnings_code": "reg",
            "gross_cents": "100",
            "tax_withheld_cents": "10",
        }
    )
    assert ev.earnings_code == "REG"
    assert ev.gross_cents == 100
    assert ev.tax_withheld_cents == 10

