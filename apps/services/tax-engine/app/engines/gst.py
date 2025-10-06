from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Dict, Mapping, Tuple

from ..domains.demo_data import GST_JOURNALS

RULES_DIR = Path(__file__).resolve().parents[1] / "rules"


@lru_cache(maxsize=1)
def _load_core() -> Mapping[str, object]:
    with (RULES_DIR / "gst_core.json").open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _to_decimal_cents(value: Decimal) -> int:
    cents = (value * Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(cents)


def _sum_entries(entries, rate: Decimal) -> Tuple[Decimal, Decimal, Decimal]:
    taxable_total = Decimal("0")
    gst_total = Decimal("0")
    exempt_total = Decimal("0")
    for entry in entries:
        net = Decimal(entry.get("net_cents", 0)) / Decimal(100)
        code = str(entry.get("tax_code", "GST")).upper()
        if code == "GST":
            taxable_total += net + (net * rate)
            gst_total += net * rate
        elif code == "GST_FREE":
            exempt_total += net
        elif code == "INPUT_TAXED":
            exempt_total += net
        else:
            taxable_total += net
    return taxable_total, gst_total, exempt_total


def compute_gst(request: Mapping[str, object]) -> Dict[str, Dict[str, int]]:
    abn = str(request.get("abn"))
    period_id = str(request.get("periodId"))
    basis = str(request.get("basis") or "accrual").lower()
    core = _load_core()
    allowed = {str(b).lower() for b in core.get("attribution", [])}
    if basis not in allowed:
        raise ValueError(f"Unsupported GST attribution basis '{basis}'")
    rate = Decimal(str(core.get("rate", 0)))

    override_sales = request.get("sales")
    override_purchases = request.get("purchases")
    if override_sales is None and override_purchases is None:
        journal = GST_JOURNALS.get((abn, period_id), {"sales": [], "purchases": []})
        sales = journal.get("sales", [])
        purchases = journal.get("purchases", [])
    else:
        sales = override_sales or []
        purchases = override_purchases or []

    taxable_sales, gst_sales, exempt_sales = _sum_entries(sales, rate)
    taxable_purchases, gst_purchases, exempt_purchases = _sum_entries(purchases, rate)

    labels = {
        "G1": _to_decimal_cents(taxable_sales + exempt_sales),
        "G10": _to_decimal_cents(exempt_sales),
        "G11": _to_decimal_cents(exempt_purchases),
    }
    credits = {"1B": _to_decimal_cents(gst_purchases)}
    payable = {"1A": _to_decimal_cents(gst_sales)}
    return {"labels": labels, "credits": credits, "payable": payable}
