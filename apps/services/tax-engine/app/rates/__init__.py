from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Dict, Iterable, Optional, Protocol, Sequence, Tuple


@dataclass(frozen=True)
class PaygwBracket:
    """Represents a single PAYG-W bracket expressed in cents."""

    threshold_cents: Optional[int]
    rate: Decimal


@dataclass(frozen=True)
class RatesVersion:
    """All indirect tax rates applicable for a given effective period."""

    id: str
    effective_from: date
    effective_to: Optional[date]
    gst_rate: Decimal
    paygw_brackets: Tuple[PaygwBracket, ...]
    checksum: str


class RatesPort(Protocol):
    """Port abstraction for providing tax rate versions."""

    port_name: str

    def versions(self) -> Sequence[RatesVersion]:
        ...

    def version_for(self, effective_date: date) -> RatesVersion:
        ...

    def latest(self) -> RatesVersion:
        ...

    def evidence(self, version: RatesVersion) -> Dict[str, str]:
        ...


def compute_version_checksum(
    version_id: str,
    effective_from: date,
    effective_to: Optional[date],
    gst_rate: Decimal,
    paygw_brackets: Iterable[PaygwBracket],
) -> str:
    """Create a deterministic checksum for the supplied rates data."""

    canonical = {
        "id": version_id,
        "effective_from": effective_from.isoformat(),
        "effective_to": effective_to.isoformat() if effective_to else None,
        "gst_rate": str(gst_rate.normalize()),
        "paygw_brackets": [
            {
                "threshold_cents": bracket.threshold_cents,
                "rate": str(bracket.rate.normalize()),
            }
            for bracket in paygw_brackets
        ],
    }
    message = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(message).hexdigest()


def evidence_for(port_name: str, version: RatesVersion) -> Dict[str, str]:
    """Utility helper for consistent evidence payloads."""

    return {"port": port_name, "id": version.id, "checksum": version.checksum}


__all__ = [
    "PaygwBracket",
    "RatesVersion",
    "RatesPort",
    "compute_version_checksum",
    "evidence_for",
]
