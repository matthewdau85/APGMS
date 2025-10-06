from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Mapping

from .utils import round_cents, to_decimal


@dataclass(frozen=True)
class TableEntry:
    lower: Decimal
    upper: Decimal | None
    rate: Decimal
    base: Decimal

    @classmethod
    def from_mapping(cls, mapping: Mapping[str, Any]) -> "TableEntry":
        return cls(
            lower=to_decimal(mapping["lower"]),
            upper=to_decimal(mapping["upper"]) if mapping.get("upper") is not None else None,
            rate=to_decimal(mapping["rate"]),
            base=to_decimal(mapping.get("base", 0)),
        )


def _select_table(rules: Mapping[str, Any], period: str, residency: str, tfn_provided: bool, tax_free_threshold: bool) -> List[TableEntry]:
    tables = rules.get("period_tables", {})
    if period not in tables:
        raise KeyError(f"Unsupported PAYGW period '{period}'")

    per_period = tables[period]
    residency = residency.lower()

    if residency not in per_period:
        raise KeyError(f"Unsupported residency '{residency}' for PAYGW")

    res_rules = per_period[residency]

    if not tfn_provided:
        source = res_rules.get("no_tfn") or res_rules.get("with_tfn")
    else:
        source = res_rules.get("with_tfn")

    if source is None:
        raise KeyError(f"No tables for residency '{residency}' and TFN flag {tfn_provided}")

    if isinstance(source, Mapping) and "tax_free_threshold" in source:
        key = "tax_free_threshold" if tax_free_threshold else "no_tax_free_threshold"
        table_data = source.get(key)
    else:
        table_data = source

    if not table_data:
        raise KeyError(f"Missing PAYGW table data for residency '{residency}' and period '{period}'")

    return [TableEntry.from_mapping(entry) for entry in table_data]


def compute_bracket(gross: Decimal, table: Iterable[TableEntry]) -> Decimal:
    for entry in table:
        if entry.upper is None or gross <= entry.upper:
            taxable = gross - entry.lower
            if taxable < Decimal("0"):
                taxable = Decimal("0")
            return entry.base + taxable * entry.rate
    # Should not happen as last bracket upper should be None
    return Decimal("0")


def _offset_total(rules: Mapping[str, Any], codes: Iterable[str]) -> Decimal:
    offsets = rules.get("offsets", {})
    total = Decimal("0")
    for code in codes:
        if code in offsets:
            total += to_decimal(offsets[code])
    return total


def compute(event: Dict[str, Any], rules: Mapping[str, Any]) -> Dict[str, Any]:
    paygw = event.get("payg_w") or {}
    gross = round_cents(paygw.get("gross", 0))
    period = (paygw.get("period") or "weekly").lower()
    residency = (paygw.get("residency") or "resident").lower()
    tfn_provided = bool(paygw.get("tfn_provided", True))
    tax_free_threshold = bool(paygw.get("tax_free_threshold", True))
    additional = round_cents(paygw.get("additional_withholding", 0))
    offset_codes: Iterable[str] = paygw.get("offset_codes") or []

    rounding_mode = rules.get("rounding", "HALF_UP")
    if rounding_mode != "HALF_UP":  # pragma: no cover - defensive (rules are HALF_UP)
        raise ValueError("Only HALF_UP rounding is supported")

    explain: List[str] = [
        f"period={period}",
        f"residency={residency}",
        f"tfn_provided={tfn_provided}",
        f"tax_free_threshold={tax_free_threshold}",
    ]

    if not tfn_provided:
        top_rate = to_decimal(rules.get("top_withholding_rate", 0.47))
        withholding = gross * top_rate
        explain.append("no_tfn_top_rate")
    else:
        table = _select_table(rules, period, residency, tfn_provided, tax_free_threshold)
        withholding = compute_bracket(gross, table)

    offsets = _offset_total(rules, offset_codes)
    if offsets:
        explain.append(f"offsets={round_cents(offsets)}")
    withholding -= offsets
    if withholding < Decimal("0"):
        withholding = Decimal("0")
    if additional:
        explain.append(f"additional={additional}")
    withholding += additional

    withholding = round_cents(withholding)

    return {
        "gross": float(gross),
        "withholding": float(withholding),
        "net": float(gross - withholding),
        "explain": explain,
    }


def compute_withholding_for_gross(gross: float, method: str, params: Mapping[str, Any]) -> float:
    # Backwards compatibility shim for existing tests/tools expecting this helper.
    if method != "table_ato":
        raise ValueError("Only table_ato method is supported in the new PAYGW engine")

    rules = params.get("rules") or {}
    event = {
        "payg_w": {
            "gross": gross,
            "period": params.get("period", "weekly"),
            "residency": params.get("residency", "resident"),
            "tax_free_threshold": params.get("tax_free_threshold", True),
            "tfn_provided": params.get("tfn_provided", True),
            "offset_codes": params.get("offset_codes", []),
            "additional_withholding": params.get("additional_withholding", 0),
        }
    }
    return compute(event, rules)["withholding"]
