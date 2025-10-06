from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Tuple

from . import gst, payg_i, payg_w
from .utils import decimal_to_float_map, parse_date, round_cents, within
from ..rules import RuleSegment, segments_for_period


def _period_dates(period: Dict[str, Any]) -> Tuple[date, date]:
    start = parse_date(period.get("start"))
    end = parse_date(period.get("end"))
    if not start or not end:
        raise ValueError("period requires start and end dates")
    return start, end


def _compute_paygw_segment(data: Dict[str, Any], segment: RuleSegment) -> Tuple[Dict[str, Decimal], List[Dict[str, Any]]]:
    labels: Dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    lines: List[Dict[str, Any]] = []
    for line in data.get("payruns", []):
        run_date = parse_date(line.get("date"))
        if not within(run_date, segment.effective_from, segment.to):
            continue
        result = payg_w.compute({"payg_w": line}, segment.paygw)
        gross = round_cents(line.get("gross", 0))
        withholding = round_cents(result["withholding"])
        labels["W1"] += gross
        labels["W2"] += withholding
        lines.append(
            {
                "date": run_date.isoformat() if run_date else None,
                "gross": float(gross),
                "withholding": float(withholding),
                "residency": line.get("residency", "resident"),
            }
        )
    return labels, lines


def _compute_paygi_segment(data: Dict[str, Any], segment: RuleSegment, period_start: date, period_end: date, applied: bool) -> Tuple[Dict[str, Decimal], Dict[str, Any] | None, bool]:
    if applied:
        return {}, None, True
    if not data:
        return {}, None, applied
    eff_date = parse_date(data.get("effective_date")) or period_end
    if not within(eff_date, segment.effective_from, segment.to):
        return {}, None, applied
    result = payg_i.compute({"payg_i": data}, segment.paygi)
    labels = {label: round_cents(amount) for label, amount in result["labels"].items()}
    return labels, result, True


def compute_totals(abn: str, period_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    period_start, period_end = _period_dates(data.get("period", {}))
    segments, version = segments_for_period(period_start, period_end)
    gst_basis = (data.get("gst", {}).get("basis") or data.get("period", {}).get("gst_basis") or "accrual").lower()

    total_labels: Dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    segment_outputs: List[Dict[str, Any]] = []
    paygi_applied = False

    for segment in segments:
        segment_labels: Dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
        gst_result = gst.compute_segment(data.get("gst", {}), gst_basis, segment.effective_from, segment.to)
        for label, amount in gst_result["labels"].items():
            segment_labels[label] += amount
            total_labels[label] += amount

        paygw_labels, paygw_lines = _compute_paygw_segment(data.get("paygw", {}), segment)
        for label, amount in paygw_labels.items():
            segment_labels[label] += amount
            total_labels[label] += amount

        paygi_labels, paygi_detail, paygi_applied = _compute_paygi_segment(
            data.get("paygi", {}), segment, period_start, period_end, paygi_applied
        )
        for label, amount in paygi_labels.items():
            segment_labels[label] += amount
            total_labels[label] += amount

        segment_outputs.append(
            {
                "effective_from": segment.effective_from.isoformat(),
                "to": segment.to.isoformat(),
                "labels": decimal_to_float_map(segment_labels),
                "gst_adjustments": gst_result["adjustments"],
                "dgst": gst_result["dgst"],
                "paygw_runs": paygw_lines,
                "paygi": paygi_detail,
            }
        )

    return {
        "abn": abn,
        "period_id": period_id,
        "rates_version": version,
        "labels": decimal_to_float_map(total_labels),
        "segments": segment_outputs,
    }
