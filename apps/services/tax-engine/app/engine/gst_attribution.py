from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence

RULES_DIR = Path(__file__).resolve().parents[1] / "rules"
BASIS_RULES_FILE = RULES_DIR / "gst_basis.json"
CROSS_BORDER_RULES_FILE = RULES_DIR / "gst_cross_border_2025.json"

BAS_LABELS = ["G1", "G2", "G3", "G10", "G11", "1A", "1B", "7", "1C", "1E"]


def _as_date(value: date | datetime | str) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    return datetime.fromisoformat(str(value)).date()


def _to_decimal(value) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass
class Segment:
    basis: str
    start: date
    end: date
    rule_hash: str

    def to_dict(self) -> Dict[str, str]:
        return {
            "basis": self.basis,
            "effective_from": self.start.isoformat(),
            "effective_to": self.end.isoformat(),
            "rule_hash": self.rule_hash,
        }


def load_basis_rules(path: Path | None = None) -> Dict:
    rules_path = path or BASIS_RULES_FILE
    with open(rules_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_cross_border_rules(path: Path | None = None) -> Dict:
    rules_path = path or CROSS_BORDER_RULES_FILE
    with open(rules_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def initial_bas_summary() -> Dict[str, Decimal]:
    return {label: Decimal("0.00") for label in BAS_LABELS}


def _determine_segments(
    period_start: date,
    period_end: date,
    basis_schedule: Sequence[Dict[str, str]],
    rules: Dict,
) -> List[Segment]:
    if not basis_schedule:
        raise ValueError("basis_schedule must include at least one entry")

    sorted_schedule = sorted(
        (
            {
                "basis": entry["basis"].lower(),
                "effective_from": _as_date(entry["effective_from"]),
            }
            for entry in basis_schedule
        ),
        key=lambda item: item["effective_from"],
    )

    current_basis: Optional[str] = None
    current_start: Optional[date] = None
    segments: List[Segment] = []

    for entry in sorted_schedule:
        basis = entry["basis"]
        eff = entry["effective_from"]
        if eff <= period_start:
            current_basis = basis
            current_start = period_start
        elif eff <= period_end:
            if current_basis is None:
                current_basis = basis
                current_start = eff
            else:
                if current_start is None:
                    current_start = eff
                seg_end = eff - timedelta(days=1)
                segments.append(
                    Segment(current_basis, current_start, seg_end, rules[current_basis]["rule_hash"])
                )
                current_basis = basis
                current_start = eff
    if current_basis is None:
        # default to earliest basis if no effective before period start
        first = sorted_schedule[0]
        current_basis = first["basis"]
        current_start = max(period_start, first["effective_from"])
    if current_start is None:
        current_start = period_start
    segments.append(Segment(current_basis, current_start, period_end, rules[current_basis]["rule_hash"]))

    # merge any consecutive segments with same basis
    merged: List[Segment] = []
    for seg in segments:
        if merged and merged[-1].basis == seg.basis and merged[-1].end >= seg.start - timedelta(days=1):
            merged[-1].end = seg.end
        else:
            merged.append(seg)
    return merged


def _recognition_date(tx: Dict, basis: str) -> Optional[date]:
    if basis == "cash":
        cash_keys = ["payment_date", "received_date", "cash_date"]
        for key in cash_keys:
            if key in tx and tx[key]:
                return _as_date(tx[key])
        if "invoice_date" in tx:
            return _as_date(tx["invoice_date"])
    else:
        accrual_keys = ["invoice_date", "supply_date", "accrual_date"]
        for key in accrual_keys:
            if key in tx and tx[key]:
                return _as_date(tx[key])
        if "payment_date" in tx:
            return _as_date(tx["payment_date"])
    return None


def _apply_cross_border_overrides(
    tx: Dict,
    amount_label: str,
    gst_label: str,
    cross_border_rules: Dict,
) -> tuple[str, str]:
    scheme = (tx.get("scheme") or tx.get("cross_border"))
    if not scheme:
        return amount_label, gst_label
    scheme = scheme.lower()
    rule = cross_border_rules.get(scheme)
    if not rule:
        return amount_label, gst_label

    labels = rule.get("labels", {})
    amount_label = labels.get(tx.get("type", "sale"), labels.get("sale", amount_label))
    gst_label = labels.get("gst", gst_label)

    if scheme == "lvig":
        threshold = Decimal(str(rule.get("threshold", "0")))
        amount = _to_decimal(tx.get("amount", "0"))
        if threshold and amount > threshold:
            return amount_label, gst_label
    if scheme == "marketplace" and not tx.get("marketplace_collected", True):
        return amount_label, gst_label
    return amount_label, gst_label


def attribute_period(
    period_start: date | str,
    period_end: date | str,
    transactions: Iterable[Dict],
    basis_schedule: Sequence[Dict[str, str]],
    *,
    rules: Optional[Dict] = None,
    cross_border_rules: Optional[Dict] = None,
) -> tuple[Dict[str, Decimal], Dict[str, List[Dict[str, str]]]]:
    start = _as_date(period_start)
    end = _as_date(period_end)
    rules = rules or load_basis_rules()
    cross_border_rules = cross_border_rules or load_cross_border_rules()

    segments = _determine_segments(start, end, basis_schedule, rules)
    bas_summary = initial_bas_summary()

    for segment in segments:
        for tx in transactions:
            recognition = _recognition_date(tx, segment.basis)
            if recognition is None:
                continue
            if not (segment.start <= recognition <= segment.end):
                continue
            amount = _to_decimal(tx.get("amount", "0"))
            gst_amount = _to_decimal(tx.get("gst", "0"))
            tax_code = (tx.get("tax_code") or "GST").upper()
            tx_type = tx.get("type", "sale").lower()

            amount_label = "G1" if tx_type == "sale" else "G11"
            gst_label = "1A" if tx_type == "sale" else "1B"

            if tx_type == "import":
                amount_label = "G10"
                gst_label = "1B"
            elif tx_type == "export":
                amount_label = "G2"
                gst_label = "1A"

            amount_label, gst_label = _apply_cross_border_overrides(
                tx, amount_label, gst_label, cross_border_rules
            )

            if tax_code in {"GST_FREE", "ZERO_RATED"}:
                gst_amount = Decimal("0.00")
                if tx_type == "sale":
                    amount_label = "G3" if tax_code == "GST_FREE" else "G2"
            elif tax_code in {"EXEMPT", "INPUT_TAXED"}:
                gst_amount = Decimal("0.00")
            bas_summary.setdefault(amount_label, Decimal("0.00"))
            bas_summary.setdefault(gst_label, Decimal("0.00"))

            bas_summary[amount_label] += amount
            if gst_amount:
                bas_summary[gst_label] += gst_amount

    evidence = {
        "segments": [segment.to_dict() for segment in segments],
        "adjustments": [],
        "dgst": [],
        "ritc": [],
        "wet_lct": [],
    }
    return bas_summary, evidence
