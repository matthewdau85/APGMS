#!/usr/bin/env python3
"""Golden vector evaluator for BAS totals and RPT hash.

Usage:
  python tools/golden_eval.py --events goldens/foo/events.json --expected goldens/foo/expected.json

The script computes BAS label totals from canonical events and derives a
signature hash for the RPT payload using the lightweight libs/rpt module.
If --expected is supplied the JSON is compared byte-for-byte after
canonicalisation and a non-zero exit status is returned on mismatch.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

REPO_ROOT = Path(__file__).resolve().parents[1]

# Ensure we can import the simple tax helpers and HMAC signer.
sys.path.insert(0, str(REPO_ROOT / "apps" / "services" / "tax-engine"))
from app.tax_rules import gst_line_tax  # type: ignore  # noqa: E402

sys.path.insert(0, str(REPO_ROOT / "libs"))
from rpt.rpt import sign as rpt_sign  # type: ignore  # noqa: E402


def _canonical(data: Any) -> str:
    """JSON canonical form used for digests and comparisons."""
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _round_cents_to_dollars(cents: int) -> float:
    return round(cents / 100.0, 2)


@dataclass
class Totals:
    w1: int = 0
    w2: int = 0
    one_a: int = 0
    one_b: int = 0

    @property
    def paygw_cents(self) -> int:
        return self.w2

    @property
    def gst_cents(self) -> int:
        return self.one_a - self.one_b


def _event_sort_key(evt: Dict[str, Any]) -> Tuple[Any, ...]:
    return (
        evt.get("period_id"),
        evt.get("reported_period"),
        evt.get("event_type"),
        evt.get("monotonic_seq"),
        evt.get("dedupe_key"),
        evt.get("txn_id"),
        evt.get("signed_at"),
        _canonical(evt),
    )


def _collect_source_digest(events: Iterable[Dict[str, Any]]) -> str:
    ordered = sorted((json.loads(_canonical(e)) for e in events), key=_event_sort_key)
    return hashlib.sha256(_canonical(ordered).encode("utf-8")).hexdigest()


def _ensure_int(value: Any) -> int:
    if isinstance(value, bool):  # bool is subclass of int
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(round(value))
    if value is None:
        return 0
    try:
        return int(value)
    except Exception as exc:  # pragma: no cover - defensive
        raise ValueError(f"Expected integer-like value, got {value!r}") from exc


def _process_events(bundle: Dict[str, Any]) -> Tuple[Totals, Dict[str, List[Dict[str, Any]]]]:
    period = bundle.get("period_id")
    if not isinstance(period, str):
        raise ValueError("bundle.period_id must be a string")

    totals = Totals()
    source_events: Dict[str, List[Dict[str, Any]]] = {}

    payroll_seen: Dict[str, Tuple[int, int]] = {}
    pos_seen: Dict[str, Tuple[int, int]] = {}

    for raw_evt in bundle.get("events", []):
        if not isinstance(raw_evt, dict):
            continue
        evt = json.loads(_canonical(raw_evt))  # deep copy + stable types
        event_type = evt.get("event_type")
        if not event_type:
            continue

        reported_period = evt.get("reported_period") or evt.get("period_id") or period
        if reported_period != period:
            continue

        source_events.setdefault(event_type, []).append(evt)

        if event_type == "payroll":
            dedupe = evt.get("dedupe_key") or f"payroll:{evt.get('monotonic_seq', '')}"
            if not isinstance(dedupe, str) or not dedupe:
                raise ValueError("payroll event missing dedupe_key")

            ref = evt.get("amends")
            if isinstance(ref, str) and ref:
                prev = payroll_seen.pop(ref, None)
                if prev:
                    prev_gross, prev_withheld = prev
                    totals.w1 -= prev_gross
                    totals.w2 -= prev_withheld

            prev = payroll_seen.get(dedupe)
            if prev:
                prev_gross, prev_withheld = prev
                totals.w1 -= prev_gross
                totals.w2 -= prev_withheld

            gross = _ensure_int(evt.get("gross_cents"))
            withheld = _ensure_int(evt.get("withholding_cents"))
            payroll_seen[dedupe] = (gross, withheld)
            totals.w1 += gross
            totals.w2 += withheld

        elif event_type == "pos":
            key = evt.get("txn_id") or evt.get("dedupe_key") or f"pos:{evt.get('monotonic_seq', '')}"
            if not isinstance(key, str) or not key:
                raise ValueError("pos event missing txn_id/dedupe_key")

            ref = evt.get("amends")
            if isinstance(ref, str) and ref:
                prev = pos_seen.pop(ref, None)
                if prev:
                    prev_gst, prev_credit = prev
                    totals.one_a -= prev_gst
                    totals.one_b -= prev_credit

            prev = pos_seen.get(key)
            if prev:
                prev_gst, prev_credit = prev
                totals.one_a -= prev_gst
                totals.one_b -= prev_credit

            gst_sum = 0
            credit_sum = _ensure_int(evt.get("gst_credit_cents"))
            for line in evt.get("lines", []):
                if not isinstance(line, dict):
                    continue
                qty = float(line.get("qty", 0))
                unit = _ensure_int(line.get("unit_price_cents"))
                discount = _ensure_int(line.get("discount_cents"))
                line_total = int(round(qty * unit)) - discount
                tax_code = (line.get("tax_code") or "GST").upper()
                line_gst = gst_line_tax(abs(line_total), tax_code)
                if line_total < 0:
                    line_gst = -line_gst
                gst_sum += line_gst

            pos_seen[key] = (gst_sum, credit_sum)
            totals.one_a += gst_sum
            totals.one_b += credit_sum

        elif event_type == "bank":
            credit = _ensure_int(evt.get("gst_credit_cents"))
            totals.one_b += credit

    return totals, source_events


def compute_bundle(events_path: Path) -> Dict[str, Any]:
    bundle = json.loads(events_path.read_text(encoding="utf-8"))
    totals, source_events = _process_events(bundle)

    bas = {
        "period_id": bundle.get("period_id"),
        "labels_cents": {
            "W1": totals.w1,
            "W2": totals.w2,
            "1A": totals.one_a,
            "1B": totals.one_b,
        },
        "totals": {
            "paygw_cents": totals.paygw_cents,
            "gst_cents": totals.gst_cents,
        },
    }

    digests = {
        et: _collect_source_digest(evts)
        for et, evts in sorted(source_events.items())
        if evts
    }

    anomaly_score = float(bundle.get("anomaly_score", 0.0))
    nonce_seed = f"{bas['period_id']}|{totals.paygw_cents}|{totals.gst_cents}|{_canonical(digests)}"
    nonce = hashlib.sha256(nonce_seed.encode("utf-8")).hexdigest()[:16]

    expires_at = int(bundle.get("expires_at", 4102444800))

    rpt_payload = {
        "period_id": bas["period_id"],
        "paygw_total": _round_cents_to_dollars(totals.paygw_cents),
        "gst_total": _round_cents_to_dollars(totals.gst_cents),
        "source_digests": digests,
        "anomaly_score": anomaly_score,
        "expires_at": expires_at,
        "nonce": nonce,
    }

    payload_c14n = _canonical(rpt_payload)
    signature = rpt_sign(json.loads(payload_c14n))
    payload_sha256 = hashlib.sha256(payload_c14n.encode("utf-8")).hexdigest()

    rpt = {
        "payload": rpt_payload,
        "payload_sha256": payload_sha256,
        "signature": signature,
    }

    return {"bas": bas, "rpt": rpt}


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compute BAS/RPT goldens")
    parser.add_argument("--events", required=True, type=Path, help="Path to events.json")
    parser.add_argument("--expected", type=Path, help="Optional expected.json for comparison")
    parser.add_argument("--write", type=Path, help="Write computed output to this path")
    parser.add_argument("--pretty", action="store_true", help="Print the computed JSON")
    args = parser.parse_args(argv)

    result = compute_bundle(args.events)
    result_json = json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False) + "\n"

    if args.write:
        args.write.write_text(result_json, encoding="utf-8")

    if args.expected:
        expected = json.loads(args.expected.read_text(encoding="utf-8"))
        if result != expected:
            actual_c14n = _canonical(result)
            expected_c14n = _canonical(expected)
            sys.stderr.write("Golden mismatch for " + str(args.events) + "\n")
            sys.stderr.write("Expected:\n" + expected_c14n + "\n")
            sys.stderr.write("Actual:\n" + actual_c14n + "\n")
            return 1

    if args.pretty or not args.expected:
        sys.stdout.write(result_json)
    return 0


if __name__ == "__main__":
    os.environ.setdefault("APGMS_RPT_SECRET", "dev-secret-change-me")
    raise SystemExit(main())
