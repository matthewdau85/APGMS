from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TAX_ENGINE = ROOT / "apps" / "services" / "tax-engine"
if str(TAX_ENGINE) not in sys.path:
    sys.path.insert(0, str(TAX_ENGINE))

from app.schedules import gst_labels  # type: ignore  # noqa: E402


INVOICE_LINES = [
    {"type": "sale", "amount": 1100, "tax_code": "GST", "paid": True},
    {"type": "sale", "amount": 500, "tax_code": "GST_FREE", "paid": True},
    {"type": "sale", "amount": 800, "tax_code": "EXPORT", "paid": False},
    {"type": "purchase", "amount": 550, "tax_code": "PURCHASE_GST_CAPITAL", "capital": True, "paid": True},
    {"type": "purchase", "amount": 330, "tax_code": "PURCHASE_GST", "capital": False, "paid": False},
]


def test_cash_basis_labels():
    labels = gst_labels(INVOICE_LINES, basis="cash")
    assert labels == {
        "G1": 1600,  # only paid sales
        "G2": 0,
        "G3": 500,
        "G10": 550,
        "G11": 0,
        "1A": 100,
        "1B": 50,
    }


def test_accrual_basis_labels():
    labels = gst_labels(INVOICE_LINES, basis="accrual")
    assert labels == {
        "G1": 2400,
        "G2": 800,
        "G3": 500,
        "G10": 550,
        "G11": 330,
        "1A": 100,
        "1B": 80,
    }
