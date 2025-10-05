from __future__ import annotations

import csv
import os
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


def _default_dev_dir() -> Path:
    base = os.getenv("APGMS_MOCK_RATES_DIR")
    if base:
        return Path(base).resolve()
    return _repo_root() / "rates" / "dev"


class MockRatesPort(RatesPort):
    """Loads rates data from CSV files under /rates/dev for local testing."""

    port_name = "mock"

    def __init__(self, directory: Optional[os.PathLike[str] | str] = None) -> None:
        self._directory = Path(directory).resolve() if directory else _default_dev_dir().resolve()
        if not self._directory.exists():
            raise FileNotFoundError(f"mock rates directory not found: {self._directory}")
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
        versions_path = self._directory / "versions.csv"
        paygw_path = self._directory / "paygw_brackets.csv"
        if not versions_path.exists():
            raise FileNotFoundError(f"expected versions.csv at {versions_path}")
        if not paygw_path.exists():
            raise FileNotFoundError(f"expected paygw_brackets.csv at {paygw_path}")

        raw_versions = self._read_versions(versions_path)
        paygw = self._read_paygw_brackets(paygw_path)

        versions: List[RatesVersion] = []
        for version_id, meta in raw_versions.items():
            brackets = paygw.get(version_id)
            if not brackets:
                raise ValueError(f"no PAYG-W brackets configured for rates version {version_id}")
            checksum = compute_version_checksum(
                version_id,
                meta["effective_from"],
                meta["effective_to"],
                meta["gst_rate"],
                brackets,
            )
            versions.append(
                RatesVersion(
                    id=version_id,
                    effective_from=meta["effective_from"],
                    effective_to=meta["effective_to"],
                    gst_rate=meta["gst_rate"],
                    paygw_brackets=tuple(brackets),
                    checksum=checksum,
                )
            )
        versions.sort(key=lambda v: v.effective_from)
        if not versions:
            raise ValueError("no rates versions loaded from mock data")
        return tuple(versions)

    def _read_versions(self, path: Path) -> Dict[str, Dict[str, object]]:
        versions: Dict[str, Dict[str, object]] = {}
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                version_id = (row.get("id") or "").strip()
                if not version_id:
                    continue
                effective_from = date.fromisoformat((row.get("effective_from") or "").strip())
                effective_to_raw = (row.get("effective_to") or "").strip()
                effective_to = date.fromisoformat(effective_to_raw) if effective_to_raw else None
                gst_rate = Decimal((row.get("gst_rate") or "0").strip())
                versions[version_id] = {
                    "effective_from": effective_from,
                    "effective_to": effective_to,
                    "gst_rate": gst_rate,
                }
        if not versions:
            raise ValueError(f"no versions defined in {path}")
        return versions

    def _read_paygw_brackets(self, path: Path) -> Dict[str, List[PaygwBracket]]:
        brackets: Dict[str, List[PaygwBracket]] = {}
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                version_id = (row.get("version_id") or row.get("rates_version_id") or "").strip()
                if not version_id:
                    continue
                threshold_raw = (row.get("threshold_cents") or "").strip()
                threshold = int(threshold_raw) if threshold_raw else None
                rate_raw = (row.get("rate") or row.get("rate_fraction") or "").strip()
                if not rate_raw:
                    raise ValueError(f"missing rate for PAYG-W bracket in {path}")
                rate = Decimal(rate_raw)
                brackets.setdefault(version_id, []).append(PaygwBracket(threshold, rate))
        for value in brackets.values():
            value.sort(key=lambda b: (b.threshold_cents is None, b.threshold_cents or 0))
        return brackets


__all__ = ["MockRatesPort"]
