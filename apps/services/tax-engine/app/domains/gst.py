from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Mapping

from .utils import parse_date, round_cents, within


def _attribute_date(txn: Mapping[str, Any], basis: str) -> date | None:
    if basis == "cash":
        primary = txn.get("payment_date") or txn.get("receipt_date")
        fallback = txn.get("invoice_date")
    else:
        primary = txn.get("invoice_date")
        fallback = txn.get("payment_date") or txn.get("receipt_date")
    primary_date = parse_date(primary) if primary else None
    fallback_date = parse_date(fallback) if fallback else None
    return primary_date or fallback_date


def _apply_labels(target: Dict[str, Decimal], labels: Mapping[str, Any]) -> None:
    for label, amount in labels.items():
        target[label] += round_cents(amount)


def compute_segment(
    data: Mapping[str, Any],
    basis: str,
    start: date,
    end: date,
) -> Dict[str, Any]:
    labels: Dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    adjustments: List[Dict[str, Any]] = []
    dgst_entries: List[Dict[str, Any]] = []
    wet_total = Decimal("0.00")
    lct_total = Decimal("0.00")

    for txn in data.get("transactions", []):
        attr_date = _attribute_date(txn, basis)
        if not within(attr_date, start, end):
            continue
        labels_spec = txn.get("labels")
        if labels_spec:
            _apply_labels(labels, labels_spec)
            continue

        category = (txn.get("category") or "sale").lower()
        taxable = round_cents(txn.get("taxable_value", 0))
        gst_amount = round_cents(txn.get("gst", 0))

        if category == "sale":
            labels["G1"] += taxable
            labels["1A"] += gst_amount
        elif category == "purchase":
            value_label = txn.get("value_label", "G11")
            labels[value_label] += taxable
            labels["1B"] += gst_amount
        elif category == "export":
            labels["G2"] += taxable
        elif category == "input_taxed":
            labels["G4"] += taxable
        else:
            # Default to sale treatment.
            labels["G1"] += taxable
            labels["1A"] += gst_amount

    for adj in data.get("adjustments", []):
        eff_date = parse_date(adj.get("effective_date"))
        if not within(eff_date, start, end):
            continue
        label = adj.get("label", "1A")
        amount = round_cents(adj.get("amount", 0))
        direction = 1 if (adj.get("type") or "increasing").lower() == "increasing" else -1
        labels[label] += amount * direction
        adjustments.append(
            {
                "trigger": adj.get("trigger", "unspecified"),
                "label": label,
                "direction": "increase" if direction > 0 else "decrease",
                "amount": float(round_cents(amount * direction)),
            }
        )

    for dgst in data.get("imports", []):
        attr_date = parse_date(dgst.get("deferral_date") or dgst.get("payment_date"))
        if not within(attr_date, start, end):
            continue
        gst_amount = round_cents(dgst.get("gst", 0))
        labels["7"] += gst_amount
        labels["1A"] += gst_amount
        dgst_entries.append(
            {
                "import_id": dgst.get("id"),
                "amount": float(gst_amount),
                "deferred_to": attr_date.isoformat() if attr_date else None,
            }
        )

    for wet in data.get("wet", []):
        attr_date = parse_date(wet.get("effective_date"))
        if within(attr_date, start, end):
            wet_total += round_cents(wet.get("amount", 0))

    for lct in data.get("lct", []):
        attr_date = parse_date(lct.get("effective_date"))
        if within(attr_date, start, end):
            lct_total += round_cents(lct.get("amount", 0))

    return {
        "labels": labels,
        "adjustments": adjustments,
        "dgst": dgst_entries,
        "wet": wet_total,
        "lct": lct_total,
    }
