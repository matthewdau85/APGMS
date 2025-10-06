from datetime import date
from decimal import Decimal

import pytest

from app.engine import (
    apply_adjustments,
    apply_dgst,
    apply_ritc,
    apply_wet_lct,
    attribute_period,
    initial_bas_summary,
    load_adjustment_rules,
    load_basis_rules,
    load_cross_border_rules,
    load_dgst_rules,
    load_lct_rules,
    load_ritc_rules,
    load_wet_rules,
)


@pytest.fixture(scope="module")
def basis_rules():
    return load_basis_rules()


@pytest.fixture(scope="module")
def cross_border_rules():
    return load_cross_border_rules()


def test_cash_vs_accrual_attribution(basis_rules, cross_border_rules):
    transactions = [
        {
            "type": "sale",
            "amount": 1100,
            "gst": 100,
            "invoice_date": "2025-07-05",
            "payment_date": "2025-08-02",
        },
        {
            "type": "purchase",
            "amount": 550,
            "gst": 50,
            "invoice_date": "2025-07-07",
            "payment_date": "2025-07-10",
        },
    ]

    accrual_schedule = [{"basis": "accrual", "effective_from": "2025-07-01"}]
    bas_accrual, evidence_accrual = attribute_period(
        date(2025, 7, 1),
        date(2025, 7, 31),
        transactions,
        accrual_schedule,
        rules=basis_rules,
        cross_border_rules=cross_border_rules,
    )

    assert bas_accrual["G1"] == Decimal("1100.00")
    assert bas_accrual["1A"] == Decimal("100.00")
    assert bas_accrual["G11"] == Decimal("550.00")
    assert bas_accrual["1B"] == Decimal("50.00")
    assert evidence_accrual["segments"][0]["rule_hash"] == basis_rules["accrual"]["rule_hash"]

    cash_schedule = [{"basis": "cash", "effective_from": "2025-07-01"}]
    bas_cash, _ = attribute_period(
        "2025-07-01",
        "2025-07-31",
        transactions,
        cash_schedule,
        rules=basis_rules,
        cross_border_rules=cross_border_rules,
    )
    assert bas_cash["1A"] == Decimal("0.00")
    assert bas_cash["G1"] == Decimal("0.00")
    assert bas_cash["1B"] == Decimal("50.00")
    assert bas_cash["G11"] == Decimal("550.00")


def test_basis_switch_segments(basis_rules, cross_border_rules):
    transactions = [
        {
            "type": "sale",
            "amount": 220,
            "gst": 20,
            "invoice_date": "2025-07-02",
            "payment_date": "2025-07-05",
        },
        {
            "type": "sale",
            "amount": 330,
            "gst": 30,
            "invoice_date": "2025-07-20",
            "payment_date": "2025-07-25",
        },
    ]
    schedule = [
        {"basis": "cash", "effective_from": "2025-07-01"},
        {"basis": "accrual", "effective_from": "2025-07-15"},
    ]
    bas, evidence = attribute_period(
        date(2025, 7, 1),
        date(2025, 7, 31),
        transactions,
        schedule,
        rules=basis_rules,
        cross_border_rules=cross_border_rules,
    )

    assert bas["G1"] == Decimal("550.00")
    assert bas["1A"] == Decimal("50.00")
    assert len(evidence["segments"]) == 2
    bases = {segment["basis"] for segment in evidence["segments"]}
    assert bases == {"cash", "accrual"}
    for segment in evidence["segments"]:
        expected_hash = basis_rules[segment["basis"]]["rule_hash"]
        assert segment["rule_hash"] == expected_hash


def test_adjustments_feed_into_evidence():
    bas = initial_bas_summary()
    adjustments = [
        {
            "trigger": "bad_debt",
            "direction": "decreasing",
            "applies_to": "sales",
            "amount": 550,
            "gst": 50,
        }
    ]
    rules = load_adjustment_rules()
    bas, evidence = apply_adjustments(bas, adjustments, rules=rules)
    assert bas["G1"] == Decimal("-550.00")
    assert bas["1A"] == Decimal("-50.00")
    assert evidence[0]["rule_hash"] == rules["triggers"]["bad_debt"]["rule_hash"]


def test_dgst_application():
    bas = initial_bas_summary()
    rules = load_dgst_rules()
    bas, evidence = apply_dgst(
        bas,
        [
            {
                "import_declaration": "12345",
                "period": "2025-07",
                "deferred_gst": 1200,
            }
        ],
        rules=rules,
    )
    assert bas["7"] == Decimal("1200.00")
    assert bas["1A"] == Decimal("1200.00")
    assert evidence[0]["rule_hash"] == rules["rule_hash"]


def test_ritc_reduces_1b():
    bas = initial_bas_summary()
    bas["1B"] = Decimal("200.00")
    rules = load_ritc_rules()
    bas, evidence = apply_ritc(
        bas,
        [
            {"category": "financial_supplies", "gst_amount": 100},
            {"category": "managed_investment", "gst_amount": 80},
        ],
        rules=rules,
    )
    # 25 and 36 reductions respectively
    assert bas["1B"] == Decimal("200.00") - Decimal("25.00") - Decimal("36.00")
    assert len(evidence) == 2
    assert evidence[0]["rule_hash"] == rules["categories"]["financial_supplies"]["rule_hash"]


def test_cross_border_rules(basis_rules, cross_border_rules):
    transactions = [
        {
            "type": "sale",
            "amount": 900,
            "gst": 90,
            "invoice_date": "2025-07-10",
            "scheme": "lvig",
        },
        {
            "type": "sale",
            "amount": 1200,
            "gst": 120,
            "invoice_date": "2025-07-12",
            "scheme": "marketplace",
            "marketplace_collected": True,
        },
        {
            "type": "sale",
            "amount": 1500,
            "gst": 150,
            "invoice_date": "2025-07-18",
            "scheme": "simplified",
        },
    ]
    schedule = [{"basis": "accrual", "effective_from": "2025-07-01"}]
    bas, _ = attribute_period(
        date(2025, 7, 1),
        date(2025, 7, 31),
        transactions,
        schedule,
        rules=basis_rules,
        cross_border_rules=cross_border_rules,
    )
    assert bas["G3"] == Decimal("900.00")
    assert bas["G1"] == Decimal("1200.00")
    assert bas["G2"] == Decimal("1500.00")
    assert bas["1A"] == Decimal("360.00")


def test_wet_lct_application():
    bas = initial_bas_summary()
    wet_rules = load_wet_rules()
    lct_rules = load_lct_rules()
    bas, evidence = apply_wet_lct(
        bas,
        wet_items=[{"reference": "W001", "wholesale_value": 50000}],
        lct_items=[{"reference": "L001", "luxury_value": 100000, "fuel_efficient": False}],
        wet_rules=wet_rules,
        lct_rules=lct_rules,
    )
    assert bas[wet_rules["bas_label"]] == Decimal("14500.00")
    assert bas[lct_rules["bas_label"]] == Decimal("7622.67")
    types = {entry["type"] for entry in evidence}
    assert types == {"wet", "lct"}
    assert evidence[0]["rule_hash"] in {wet_rules["rule_hash"], lct_rules["rule_hash"], lct_rules["thresholds"]["other"]["rule_hash"]}

