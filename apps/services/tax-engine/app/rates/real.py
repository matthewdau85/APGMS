from __future__ import annotations

import json
import os
import hashlib
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from . import PaygwBracket, RatesPort, RatesVersion, compute_version_checksum, evidence_for


def _repo_root() -> Path:
    path = Path(__file__).resolve()
    for _ in range(6):
        path = path.parent
    return path


def _default_bundle_path() -> Path:
    bundle = os.getenv("APGMS_RATES_BUNDLE")
    if bundle:
        return Path(bundle).resolve()
    return _repo_root() / "rates" / "real" / "bundle.json"


class RealRatesPort(RatesPort):
    """Loads rates from the signed bundle that mirrors the production feed."""

    port_name = "real"

    def __init__(self, bundle_path: Optional[os.PathLike[str] | str] = None) -> None:
        self._bundle_path = Path(bundle_path).resolve() if bundle_path else _default_bundle_path().resolve()
        if not self._bundle_path.exists():
            raise FileNotFoundError(f"rates bundle not found: {self._bundle_path}")
        self._versions = self._load_versions()

    def versions(self) -> Sequence[RatesVersion]:
        return self._versions

    def version_for(self, effective_date: date) -> RatesVersion:
        for version in reversed(self._versions):
            if version.effective_from <= effective_date and (
                version.effective_to is None or effective_date <= version.effective_to
            ):
                return version
        raise LookupError(f"no rates version for date {effective_date.isoformat()}")

    def latest(self) -> RatesVersion:
        return self._versions[-1]

    def evidence(self, version: RatesVersion) -> Dict[str, str]:
        return evidence_for(self.port_name, version)

    # Internal helpers -----------------------------------------------------------------

    def _load_versions(self) -> Tuple[RatesVersion, ...]:
        with self._bundle_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        versions_payload = data.get("versions") or []
        if not versions_payload:
            raise ValueError(f"no versions defined in {self._bundle_path}")
        signature = data.get("signature")
        expected = hashlib.sha256(
            json.dumps(versions_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        if signature and signature != expected:
            raise ValueError("rates bundle signature mismatch")

        versions: List[RatesVersion] = []
        for row in versions_payload:
            version_id = (row.get("id") or "").strip()
            if not version_id:
                continue
            effective_from = date.fromisoformat(row["effective_from"])
            effective_to_raw = row.get("effective_to")
            effective_to = date.fromisoformat(effective_to_raw) if effective_to_raw else None
            gst_rate = Decimal(str(row.get("gst_rate", "0")))
            brackets_payload = row.get("paygw_brackets") or []
            brackets: List[PaygwBracket] = []
            for bracket in brackets_payload:
                threshold = bracket.get("threshold_cents")
                threshold_cents = int(threshold) if threshold is not None else None
                rate = Decimal(str(bracket.get("rate")))
                brackets.append(PaygwBracket(threshold_cents, rate))
            brackets.sort(key=lambda b: (b.threshold_cents is None, b.threshold_cents or 0))
            checksum = compute_version_checksum(version_id, effective_from, effective_to, gst_rate, brackets)
            versions.append(
                RatesVersion(
                    id=version_id,
                    effective_from=effective_from,
                    effective_to=effective_to,
                    gst_rate=gst_rate,
                    paygw_brackets=tuple(brackets),
                    checksum=checksum,
                )
            )
        versions.sort(key=lambda v: v.effective_from)
        if not versions:
            raise ValueError("no rates versions loaded from bundle")
        return tuple(versions)


__all__ = ["RealRatesPort"]
