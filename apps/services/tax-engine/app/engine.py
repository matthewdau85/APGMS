from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


def _decimal(value: float | int | str | Decimal) -> Decimal:
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _rounding(mode: str) -> str:
    return {
        "HALF_UP": ROUND_HALF_UP,
        "HALF_EVEN": ROUND_HALF_EVEN,
    }.get(mode.upper(), ROUND_HALF_UP)


def _quantize_to_cents(amount: Decimal, rounding_mode: str) -> int:
    quantized = amount.quantize(Decimal("0.01"), rounding=_rounding(rounding_mode))
    cents = quantized * 100
    return int(cents.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _round_cents(amount: Decimal, mode: str) -> int:
    cents = amount.quantize(Decimal("1"), rounding=_rounding(mode))
    return int(cents)


class RulesLoader:
    def __init__(self, rules_dir: Path):
        self._root = rules_dir
        self._manifest: Optional[Dict[str, object]] = None
        self._payg_cache: Dict[str, Dict[str, object]] = {}
        self._gst_core: Optional[Dict[str, object]] = None
        self._label_map: Optional[Dict[str, Dict[str, str]]] = None

    def _load_json(self, path: Path) -> Dict[str, object]:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    @property
    def manifest(self) -> Dict[str, object]:
        if self._manifest is None:
            self._manifest = self._load_json(self._root / "rules_manifest.json")
        return self._manifest

    def get_rates_version(self) -> str:
        return str(self.manifest.get("rates_version", "unknown"))

    def load_payg_period(self, period: str) -> Dict[str, object]:
        key = period.lower()
        if key not in self._payg_cache:
            path = self._root / "payg_w_2024_25" / f"{key}.json"
            if not path.exists():
                raise ValueError(f"PAYG schedule not found for period '{period}'")
            self._payg_cache[key] = self._load_json(path)
        return self._payg_cache[key]

    def get_payg_schedule(self, period: str, residency: str, tax_free_threshold: bool) -> Dict[str, object]:
        data = self.load_payg_period(period)
        schedules = data.get("schedules", [])
        for schedule in schedules:
            if (
                schedule.get("residency") == residency
                and bool(schedule.get("tax_free_threshold")) == bool(tax_free_threshold)
            ):
                return schedule
        raise ValueError(
            f"No PAYG schedule for period={period} residency={residency} tax_free_threshold={tax_free_threshold}"
        )

    def load_gst_core(self) -> Dict[str, object]:
        if self._gst_core is None:
            self._gst_core = self._load_json(self._root / "gst_core.json")
        return self._gst_core

    def get_label_mapping(self) -> Dict[str, Dict[str, str]]:
        if self._label_map is None:
            self._label_map = self._load_json(self._root / "bas_labels.json")
        return self._label_map


RULES = RulesLoader(Path(__file__).parent / "rules")


def compute_withholding(
    amount: float | Decimal,
    period: str,
    residency: str,
    opts: Optional[Dict[str, object]] = None,
) -> int:
    opts = opts or {}
    schedule = RULES.get_payg_schedule(period, residency, bool(opts.get("tax_free_threshold", True)))
    rounding_mode = schedule.get("rounding", "HALF_UP")
    gross = _decimal(amount)
    if gross < 0:
        gross = Decimal("0")

    selected_bracket: Optional[Dict[str, object]] = None
    for bracket in schedule.get("brackets", []):
        minimum = _decimal(bracket.get("min", 0))
        maximum = bracket.get("max")
        if gross < minimum:
            continue
        if maximum is None or gross <= _decimal(maximum):
            selected_bracket = bracket
            break
    if selected_bracket is None:
        raise ValueError(f"No bracket matched for gross={gross} period={period}")

    rate = _decimal(selected_bracket.get("rate", 0))
    offset = _decimal(selected_bracket.get("offset", 0))
    addition = _decimal(selected_bracket.get("addition", 0))
    withholding = rate * gross - offset + addition
    if withholding < 0:
        withholding = Decimal("0")

    return _quantize_to_cents(withholding, rounding_mode)


def _line_gst_cents(gross_cents: int, tax_code: str, rate: Decimal, rounding_mode: str) -> Tuple[int, int]:
    tax_code = (tax_code or "").upper()
    if tax_code not in {"GST", "INPUT_TAXED", "GST_FREE", "EXEMPT", "ZERO_RATED"}:
        tax_code = "GST"

    gross_dec = Decimal(gross_cents)
    gst_cents = Decimal("0")
    if tax_code == "GST":
        denominator = Decimal("1") + rate
        gst_cents = (gross_dec * rate) / denominator
    # Other codes (GST_FREE, EXEMPT, etc.) produce zero GST

    gst = _round_cents(gst_cents, rounding_mode)
    net = gross_cents - gst
    return gst, net


def compute_gst(
    period_id: str,
    basis: str,
    transactions: Optional[Iterable[Dict[str, object]]] = None,
) -> Dict[str, Dict[str, int] | int]:
    basis_key = (basis or "cash").lower()
    core = RULES.load_gst_core()
    rate = _decimal(core.get("rate", 0.10))
    rounding_mode = core.get("rounding", {}).get("line", "HALF_UP")

    recognised_field = core.get("recognition", {}).get(basis_key, basis_key)

    sales_gross = 0
    sales_tax = 0
    sales_net = 0
    purchases_gross = 0
    purchases_tax = 0
    purchases_net = 0

    for txn in transactions or []:
        recognised = txn.get("recognised") or txn.get("recognized")
        include = False
        if isinstance(recognised, dict):
            include = bool(recognised.get(basis_key))
        elif isinstance(recognised, (list, tuple, set)):
            include = recognised_field in recognised or basis_key in recognised
        elif recognised is None:
            include = True
        else:
            include = recognised == recognised_field or recognised == basis_key
        if not include:
            continue

        gross_cents = int(txn.get("total_cents", 0))
        tax_code = str(txn.get("tax_code", "GST"))
        gst_cents, net_cents = _line_gst_cents(gross_cents, tax_code, rate, rounding_mode)
        if str(txn.get("type", "")).lower() == "purchase":
            purchases_gross += gross_cents
            purchases_tax += gst_cents
            purchases_net += net_cents
        else:
            sales_gross += gross_cents
            sales_tax += gst_cents
            sales_net += net_cents

    mapping = RULES.get_label_mapping().get("gst", {})
    labels: Dict[str, int] = {}
    if mapping.get("sales_gross"):
        labels[mapping["sales_gross"]] = sales_gross
    if mapping.get("sales_net"):
        labels[mapping["sales_net"]] = sales_net
    if mapping.get("purchases_net"):
        labels[mapping["purchases_net"]] = purchases_net

    one_a_code = mapping.get("sales_tax", "1A")
    one_b_code = mapping.get("purchases_tax", "1B")

    result: Dict[str, Dict[str, int] | int] = {
        "labels": labels,
        "1A": sales_tax,
        "1B": purchases_tax,
    }
    if one_a_code != "1A":
        result[one_a_code] = result.pop("1A")
    if one_b_code != "1B":
        result[one_b_code] = result.pop("1B")
    return result


class InMemoryLedger:
    def __init__(self) -> None:
        self._payroll: Dict[Tuple[str, str], List[Dict[str, object]]] = {}
        self._gst: Dict[Tuple[str, str], List[Dict[str, object]]] = {}

    def load_from_path(self, path: Path) -> None:
        if not path.exists():
            return
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        for period in data.get("periods", []):
            key = (str(period.get("abn")), str(period.get("period_id")))
            self._payroll[key] = list(period.get("payroll", []))
            self._gst[key] = list(period.get("gst", []))

    def register_payroll(self, abn: str, period_id: str, entry: Dict[str, object]) -> None:
        key = (abn, period_id)
        self._payroll.setdefault(key, []).append(entry)

    def register_transaction(self, abn: str, period_id: str, txn: Dict[str, object]) -> None:
        key = (abn, period_id)
        self._gst.setdefault(key, []).append(txn)

    def clear_period(self, abn: str, period_id: str) -> None:
        key = (abn, period_id)
        self._payroll.pop(key, None)
        self._gst.pop(key, None)

    def get_payroll(self, abn: str, period_id: str) -> List[Dict[str, object]]:
        return list(self._payroll.get((abn, period_id), []))

    def get_transactions(self, abn: str, period_id: str) -> List[Dict[str, object]]:
        return list(self._gst.get((abn, period_id), []))

    def get_period_totals(self, abn: str, period_id: str, basis: str) -> Dict[str, object]:
        payroll_entries = self.get_payroll(abn, period_id)
        transactions = self.get_transactions(abn, period_id)
        if not payroll_entries and not transactions:
            raise KeyError((abn, period_id))
        w1 = 0
        w2 = 0
        for entry in payroll_entries:
            gross_cents = int(entry.get("gross_cents", 0))
            w1 += gross_cents
            period = str(entry.get("period", "weekly"))
            residency = str(entry.get("residency", "resident"))
            opts = {"tax_free_threshold": bool(entry.get("tax_free_threshold", True))}
            withholding_cents = compute_withholding(Decimal(gross_cents) / 100, period, residency, opts)
            w2 += withholding_cents

        gst_result = compute_gst(period_id, basis, transactions)
        labels = dict(gst_result.get("labels", {}))
        mapping = RULES.get_label_mapping().get("payg", {})
        if mapping.get("wages_gross"):
            labels[mapping["wages_gross"]] = w1
        if mapping.get("withheld"):
            labels[mapping["withheld"]] = w2
        labels.setdefault("1A", gst_result.get("1A", 0))
        labels.setdefault("1B", gst_result.get("1B", 0))

        result = {
            "W1": w1,
            "W2": w2,
            "1A": gst_result.get("1A", 0),
            "1B": gst_result.get("1B", 0),
            "labels": labels,
            "rates_version": RULES.get_rates_version(),
        }
        return result


ledger = InMemoryLedger()
ledger.load_from_path(Path(__file__).parent / "data" / "demo_ledger.json")


__all__ = [
    "compute_withholding",
    "compute_gst",
    "ledger",
    "RULES",
]
