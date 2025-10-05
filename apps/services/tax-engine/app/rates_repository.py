from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP
from pathlib import Path
from typing import Dict, Iterable, List, Optional

DEFAULT_STORAGE_PATH = Path(__file__).resolve().parent / "data" / "rates_versions.json"

_ROUNDING_MAP = {
    "HALF_UP": ROUND_HALF_UP,
    "HALF_EVEN": ROUND_HALF_EVEN,
}


def _parse_bool(value: Optional[str]) -> Optional[bool]:
    if value is None:
        return None
    value = value.strip()
    if value == "":
        return None
    lowered = value.lower()
    if lowered in {"true", "t", "1", "yes", "y"}:
        return True
    if lowered in {"false", "f", "0", "no", "n"}:
        return False
    raise ValueError(f"Cannot parse boolean from '{value}'")


def _parse_float(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    value = value.strip()
    if value == "":
        return None
    return float(value)


def _coerce_rounding(value: Optional[str]) -> str:
    if not value:
        return "HALF_UP"
    value = value.strip().upper()
    if value not in _ROUNDING_MAP:
        raise ValueError(f"Unsupported rounding mode '{value}'")
    return value


def _effective_to(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _normalize_scale_code(code: Optional[str]) -> str:
    code = (code or "DEFAULT").strip()
    return code.upper() or "DEFAULT"


def _slugify(*parts: str) -> str:
    cleaned: List[str] = []
    for part in parts:
        if not part:
            continue
        token = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in part)
        cleaned.append(token.strip("-"))
    return "-".join(filter(None, cleaned))


@dataclass
class RatesVersion:
    id: str
    tax_type: str
    period: Optional[str]
    method: str
    effective_from: str
    effective_to: Optional[str]
    rounding: str
    source: str
    loaded_at: str
    source_sha256: Optional[str] = None
    scales: List[Dict[str, object]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, object]:
        return {
            "id": self.id,
            "tax_type": self.tax_type,
            "period": self.period,
            "method": self.method,
            "effective_from": self.effective_from,
            "effective_to": self.effective_to,
            "rounding": self.rounding,
            "source": self.source,
            "loaded_at": self.loaded_at,
            "source_sha256": self.source_sha256,
            "scales": self.scales,
        }


class RatesRepository:
    """Simple repository for versioned PAYGW/GST rates."""

    def __init__(self, storage_path: Optional[Path | str] = None):
        self._storage_path = Path(storage_path) if storage_path else DEFAULT_STORAGE_PATH
        self._data: Optional[Dict[str, object]] = None

    @property
    def storage_path(self) -> Path:
        return self._storage_path

    def _ensure_loaded(self) -> Dict[str, object]:
        if self._data is None:
            if self._storage_path.exists():
                with self._storage_path.open("r", encoding="utf-8") as fh:
                    self._data = json.load(fh)
            else:
                self._storage_path.parent.mkdir(parents=True, exist_ok=True)
                self._data = {"versions": []}
        return self._data

    def list_versions(self) -> List[Dict[str, object]]:
        return list(self._ensure_loaded().get("versions", []))

    def upsert(self, version: RatesVersion) -> None:
        data = self._ensure_loaded()
        versions = data.setdefault("versions", [])
        versions = [v for v in versions if v.get("id") != version.id]
        versions.append(version.to_dict())
        versions.sort(key=lambda v: v.get("effective_from", ""), reverse=True)
        data["versions"] = versions
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)
        with self._storage_path.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=False)
        self._data = data

    def get_active_version(self, tax_type: str, period: Optional[str] = None, as_of: Optional[date] = None) -> Dict[str, object]:
        as_of = as_of or date.today()
        target_type = (tax_type or "").upper()
        data = self._ensure_loaded()
        versions: Iterable[Dict[str, object]] = data.get("versions", [])
        matches = [
            v for v in versions
            if (v.get("tax_type") or "").upper() == target_type
            and (period is None or (v.get("period") or "") == period)
        ]
        matches.sort(key=lambda v: v.get("effective_from", ""), reverse=True)
        for candidate in matches:
            eff_from = date.fromisoformat(candidate.get("effective_from"))
            eff_to_raw = candidate.get("effective_to")
            eff_to = date.fromisoformat(eff_to_raw) if eff_to_raw else date.max
            if eff_from <= as_of <= eff_to:
                return candidate
        if matches:
            return matches[0]
        raise LookupError(f"No rates version for tax_type={tax_type} period={period}")

    def select_scale(
        self,
        version: Dict[str, object],
        *,
        tax_free_threshold: Optional[bool] = None,
        stsl: Optional[bool] = None,
        code: Optional[str] = None,
    ) -> Dict[str, object]:
        scales: List[Dict[str, object]] = list(version.get("scales", []))
        if not scales:
            raise LookupError(f"No scales defined for rates version {version.get('id')}")
        if code:
            code = code.upper()
            for scale in scales:
                if (scale.get("code") or "").upper() == code:
                    return scale
            raise LookupError(f"Scale code '{code}' not found for version {version.get('id')}")
        filtered = [
            s for s in scales
            if (tax_free_threshold is None or bool(s.get("tax_free_threshold")) == tax_free_threshold)
            and (stsl is None or bool(s.get("stsl")) == stsl)
        ]
        if filtered:
            return filtered[0]
        return scales[0]

    def compute_progressive_cents(
        self,
        gross_cents: int,
        version: Dict[str, object],
        scale: Dict[str, object],
    ) -> int:
        if gross_cents <= 0:
            return 0
        rounding = _ROUNDING_MAP.get(str(version.get("rounding", "HALF_UP")).upper(), ROUND_HALF_UP)
        gross_dollars = Decimal(gross_cents) / Decimal(100)
        result = Decimal("0")
        brackets = sorted(scale.get("brackets", []), key=lambda b: Decimal(str(b.get("up_to", 0))))
        for bracket in brackets:
            up_to = Decimal(str(bracket.get("up_to", "0")))
            if gross_dollars <= up_to:
                a = Decimal(str(bracket.get("a", 0)))
                b = Decimal(str(bracket.get("b", 0)))
                fixed = Decimal(str(bracket.get("fixed", 0)))
                result = a * gross_dollars - b + fixed
                if result < 0:
                    result = Decimal("0")
                break
        quantized = result.quantize(Decimal("0.01"), rounding=rounding)
        cents = (quantized * Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        return int(cents)

    def compute_flat_rate_cents(
        self,
        amount_cents: int,
        version: Dict[str, object],
        scale: Dict[str, object],
    ) -> int:
        if amount_cents <= 0:
            return 0
        rounding = _ROUNDING_MAP.get(str(version.get("rounding", "HALF_UP")).upper(), ROUND_HALF_UP)
        rate = Decimal(str(scale.get("rate", 0)))
        result = (Decimal(amount_cents) / Decimal(100)) * rate
        quantized = result.quantize(Decimal("0.01"), rounding=rounding)
        cents = (quantized * Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        return int(cents)


def ingest_csv(csv_path: Path | str, repo: Optional[RatesRepository] = None, *, source: Optional[str] = None) -> List[str]:
    repo = repo or RatesRepository()
    csv_path = Path(csv_path)
    rows: List[Dict[str, str]]
    with csv_path.open("r", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        rows = [dict(row) for row in reader]
    if not rows:
        return []
    file_hash = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    grouped: Dict[tuple, Dict[str, object]] = {}
    for row in rows:
        tax_type = (row.get("tax_type") or "").strip().upper()
        period = (row.get("period") or "").strip() or None
        method = (row.get("method") or "formula_progressive").strip()
        effective_from = (row.get("effective_from") or "").strip()
        if not tax_type or not effective_from:
            raise ValueError(f"Missing tax_type or effective_from in row: {row}")
        effective_to = _effective_to(row.get("effective_to"))
        rounding = _coerce_rounding(row.get("rounding"))
        key = (tax_type, period, method, effective_from, effective_to, rounding)
        version = grouped.setdefault(
            key,
            {
                "tax_type": tax_type,
                "period": period,
                "method": method,
                "effective_from": effective_from,
                "effective_to": effective_to,
                "rounding": rounding,
                "scales": {},
            },
        )
        scales: Dict[str, Dict[str, object]] = version["scales"]  # type: ignore[assignment]
        scale_code = _normalize_scale_code(row.get("scale_code"))
        scale = scales.setdefault(
            scale_code,
            {
                "code": scale_code,
                "tax_free_threshold": _parse_bool(row.get("tax_free_threshold")),
                "stsl": _parse_bool(row.get("stsl")),
                "brackets": [],
            },
        )
        if method == "formula_progressive":
            bracket = {
                "up_to": _parse_float(row.get("up_to")),
                "a": _parse_float(row.get("a")),
                "b": _parse_float(row.get("b")) or 0.0,
                "fixed": _parse_float(row.get("fixed")) or 0.0,
            }
            if bracket["up_to"] is None:
                raise ValueError(f"Missing 'up_to' for progressive row: {row}")
            scale.setdefault("brackets", [])  # ensure list exists
            scale["brackets"].append(bracket)  # type: ignore[index]
        elif method == "flat_rate":
            rate_value = _parse_float(row.get("rate"))
            if rate_value is None:
                raise ValueError(f"Missing 'rate' for flat_rate row: {row}")
            scale["rate"] = rate_value
        else:
            raise ValueError(f"Unsupported method '{method}' in row: {row}")
    version_ids: List[str] = []
    for key, payload in grouped.items():
        tax_type, period, method, effective_from, effective_to, rounding = key
        scales_dict: Dict[str, Dict[str, object]] = payload.pop("scales")  # type: ignore[assignment]
        scales: List[Dict[str, object]] = []
        for scale in scales_dict.values():
            if method == "formula_progressive":
                brackets = sorted(
                    scale.get("brackets", []),
                    key=lambda b: Decimal(str(b.get("up_to", 0))),
                )
                scale["brackets"] = [
                    {
                        "up_to": float(br.get("up_to")),
                        "a": float(br.get("a")) if br.get("a") is not None else 0.0,
                        "b": float(br.get("b")) if br.get("b") is not None else 0.0,
                        "fixed": float(br.get("fixed")) if br.get("fixed") is not None else 0.0,
                    }
                    for br in brackets
                ]
            scales.append(scale)
        version_id = _slugify(tax_type, period or "any", method, effective_from)
        timestamp = datetime.now(UTC).replace(microsecond=0)
        version_obj = RatesVersion(
            id=version_id,
            tax_type=tax_type,
            period=period,
            method=method,
            effective_from=effective_from,
            effective_to=effective_to,
            rounding=rounding,
            source=source or csv_path.name,
            loaded_at=timestamp.isoformat().replace("+00:00", "Z"),
            source_sha256=file_hash,
            scales=scales,
        )
        repo.upsert(version_obj)
        version_ids.append(version_id)
    return version_ids


__all__ = [
    "RatesRepository",
    "RatesVersion",
    "ingest_csv",
    "DEFAULT_STORAGE_PATH",
]
