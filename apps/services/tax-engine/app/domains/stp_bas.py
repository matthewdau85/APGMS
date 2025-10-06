from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence

__all__ = [
    "STPEvent",
    "ReconciliationError",
    "load_stp_map",
    "rollup_stp_to_bas",
]

@dataclass(frozen=True)
class STPEvent:
    """Simple representation of an STP pay event."""

    stp_event_id: str
    employee_id: str
    earnings_code: str
    gross_cents: int
    tax_withheld_cents: int

    @classmethod
    def from_raw(cls, raw: Mapping[str, Any]) -> "STPEvent":
        missing = [k for k in ("stp_event_id", "employee_id", "earnings_code") if not raw.get(k)]
        if missing:
            raise ValueError(f"STP event missing required fields: {', '.join(missing)}")
        gross = int(raw.get("gross_cents", 0) or 0)
        withheld = int(raw.get("tax_withheld_cents", 0) or 0)
        return cls(
            stp_event_id=str(raw["stp_event_id"]),
            employee_id=str(raw["employee_id"]),
            earnings_code=str(raw["earnings_code"]).upper(),
            gross_cents=gross,
            tax_withheld_cents=withheld,
        )

class ReconciliationError(ValueError):
    """Raised when STP totals do not reconcile to BAS outputs."""

    def __init__(self, message: str, reconciliation: Mapping[str, Any]):
        super().__init__(message)
        self.reconciliation: Mapping[str, Any] = reconciliation

_STP_MAP: Dict[str, Dict[str, Any]] = {}

def load_stp_map(path: Optional[Path] = None) -> Dict[str, Dict[str, Any]]:
    """Load and normalise the STP earnings-code mapping."""

    target = path or Path(__file__).with_name("stp2_map.json")
    data = json.loads(target.read_text(encoding="utf-8"))
    mapping: Dict[str, Dict[str, Any]] = {}

    for code, entry in data.items():
        norm_code = str(code).upper()
        bas = entry.get("bas", {}) if isinstance(entry, Mapping) else {}
        mapping[norm_code] = {
            "description": entry.get("description", ""),
            "bas": {
                "W1": _normalise_source(bas.get("W1")),
                "W2": _normalise_source(bas.get("W2")),
            },
            "special_tags": _normalise_tags(entry.get("special_tags", [])),
        }
    return mapping

def _normalise_source(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        key = value.strip().lower()
        if key in {"gross", "salary", "earnings"}:
            return "gross"
        if key in {"withheld", "tax", "w2", "tax_withheld"}:
            return "withheld"
        if key in {"none", "exclude", "skip", "0"}:
            return None
    raise ValueError(f"Unsupported mapping source: {value!r}")

def _normalise_tags(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, Iterable):
        return [str(tag) for tag in raw if str(tag)]
    return []

def _ensure_map() -> Dict[str, Dict[str, Any]]:
    global _STP_MAP
    if not _STP_MAP:
        _STP_MAP = load_stp_map()
    return _STP_MAP

def _amount_for_label(event: STPEvent, source: Any) -> int:
    if source is None:
        return 0
    if source == "gross":
        return event.gross_cents
    if source == "withheld":
        return event.tax_withheld_cents
    if isinstance(source, (int, float)):
        return int(round(event.gross_cents * float(source)))
    raise ValueError(f"Unsupported BAS mapping source {source!r}")

def rollup_stp_to_bas(
    events: Sequence[Mapping[str, Any]] | Sequence[STPEvent],
    bas_totals: Optional[Mapping[str, Any]] = None,
    *,
    mapping: Optional[Dict[str, Dict[str, Any]]] = None,
    validate: bool = True,
) -> Dict[str, Any]:
    """Aggregate STP events into BAS label totals with traceability."""

    stp_map = mapping or _ensure_map()
    bas_labels: Dict[str, MutableMapping[str, Any]] = {
        "W1": {"total_cents": 0, "events": []},
        "W2": {"total_cents": 0, "events": []},
    }
    recon_inputs: List[Dict[str, Any]] = []
    special_events: Dict[str, List[Dict[str, Any]]] = {}

    for raw in events:
        event = raw if isinstance(raw, STPEvent) else STPEvent.from_raw(raw)
        code_info = stp_map.get(event.earnings_code)
        if not code_info:
            raise KeyError(f"Unknown earnings code: {event.earnings_code}")

        base = {
            "stp_event_id": event.stp_event_id,
            "employee_id": event.employee_id,
            "earnings_code": event.earnings_code,
        }

        w1_amount = _amount_for_label(event, code_info["bas"].get("W1"))
        w2_amount = _amount_for_label(event, code_info["bas"].get("W2"))

        if w1_amount:
            bas_labels["W1"]["total_cents"] += w1_amount
            bas_labels["W1"]["events"].append({**base, "amount_cents": w1_amount, "source": "gross"})
        if w2_amount:
            bas_labels["W2"]["total_cents"] += w2_amount
            bas_labels["W2"]["events"].append({**base, "amount_cents": w2_amount, "source": "withheld"})

        tags = code_info.get("special_tags", []) or []
        for tag in tags:
            special_events.setdefault(tag, []).append(base)

        recon_inputs.append({**base, "w1_cents": w1_amount, "w2_cents": w2_amount, "special_tags": list(tags)})

    for label in ("W1", "W2"):
        events_for_label = bas_labels[label].get("events", [])
        bas_labels[label]["stp_event_ids"] = [evt["stp_event_id"] for evt in events_for_label]

    reconciliation: Optional[Dict[str, Any]] = None
    if bas_totals is not None:
        reconciliation = {}
        ok = True
        for label in ("W1", "W2"):
            expected = int(bas_totals.get(label, 0) or 0)
            actual = int(bas_labels[label]["total_cents"])
            diff = actual - expected
            reconciliation[label] = {
                "expected_cents": expected,
                "actual_cents": actual,
                "difference_cents": diff,
            }
            if diff != 0:
                ok = False
        reconciliation["ok"] = ok
        if validate and not ok:
            raise ReconciliationError("STP totals do not reconcile with BAS outputs", reconciliation)

    result: Dict[str, Any] = {
        "bas_labels": bas_labels,
        "recon_inputs": recon_inputs,
        "special_events": special_events,
    }
    if reconciliation is not None:
        result["reconciliation"] = reconciliation
    return result

