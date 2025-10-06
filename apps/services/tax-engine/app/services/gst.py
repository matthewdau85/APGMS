from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, Iterable, Tuple

from ..rules import load_bas_labels, load_gst_rules


@dataclass(frozen=True)
class GstTotals:
    period: str
    totals: Dict[str, float]
    labels: Dict[str, float]

    def net_amount(self) -> float:
        return self.labels.get("1A", 0.0) - self.labels.get("1B", 0.0)


def _dec(value: Any) -> Decimal:
    return Decimal(str(value))


def _round_cents(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _parse_date(value: str) -> date:
    return datetime.fromisoformat(value).date()


def _period_bounds(period_id: str) -> Tuple[date, date]:
    try:
        year, month = map(int, period_id.split("-"))
    except ValueError as exc:
        raise ValueError(f"Unsupported period identifier '{period_id}'") from exc
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return start, end


def _transaction_date(tx: Dict[str, Any], basis: str) -> str | None:
    if basis == "cash":
        return tx.get("payment_date") or tx.get("date")
    return tx.get("invoice_date") or tx.get("date")


def compute_gst(
    period_id: str,
    transactions: Iterable[Dict[str, Any]],
    gst_rules: Dict[str, Any] | None = None,
    label_mappings: Dict[str, str] | None = None,
) -> GstTotals:
    gst_rules = gst_rules or load_gst_rules()
    label_mappings = label_mappings or load_bas_labels()

    start, end = _period_bounds(period_id)
    gst_rate = _dec(gst_rules.get("rate", 0.1))

    totals: Dict[str, Decimal] = {
        "sales_gross": Decimal("0"),
        "sales_taxable": Decimal("0"),
        "purchases_creditable": Decimal("0"),
        "gst_on_sales": Decimal("0"),
        "gst_on_purchases": Decimal("0"),
    }

    for tx in transactions:
        basis = (tx.get("basis") or gst_rules.get("defaults", {}).get("accounting_method", "accrual")).lower()
        date_value = _transaction_date(tx, basis)
        if not date_value:
            continue
        tx_date = _parse_date(date_value)
        if not (start <= tx_date < end):
            continue

        amount = _dec(tx.get("amount", 0))
        if amount == 0:
            continue

        tax_code = (tx.get("tax_code") or "GST").upper()
        kind = tx.get("kind", "sale").lower()

        gst_amount = Decimal("0")
        net_amount = amount
        if tax_code == "GST":
            gst_amount = _round_cents(amount / (Decimal("1") + gst_rate) * gst_rate)
            net_amount = amount - gst_amount
        elif tax_code in {"GST_FREE", "ZERO_RATED"}:
            gst_amount = Decimal("0")
            net_amount = amount
        else:
            gst_amount = Decimal("0")
            net_amount = amount

        if kind == "sale":
            totals["sales_gross"] += amount
            if tax_code == "GST":
                totals["sales_taxable"] += net_amount
                totals["gst_on_sales"] += gst_amount
        elif kind == "purchase":
            if tax_code == "GST":
                totals["purchases_creditable"] += net_amount
                totals["gst_on_purchases"] += gst_amount
        else:
            continue

    totals = {key: float(_round_cents(value)) for key, value in totals.items()}

    labels: Dict[str, float] = {}
    for domain, label in label_mappings.items():
        value = totals.get(domain)
        if value is not None:
            labels[label] = value

    return GstTotals(period=period_id, totals=totals, labels=labels)
