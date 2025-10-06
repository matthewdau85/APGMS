"""Utilities for loading and validating rule documents."""
from __future__ import annotations

import json
import hashlib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from .version import RATES_VERSION, KNOWN_RULE_FILE_HASHES

RULES_DIR = Path(__file__).resolve().parent

@dataclass(frozen=True)
class RuleDocument:
    """Container for a single rules file."""

    name: str
    path: Path
    sha256: str
    payload: Dict[str, Any]
    source_url: Optional[str]
    last_reviewed: Optional[str]


def _compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@lru_cache(maxsize=1)
def load_rule_documents() -> Dict[str, RuleDocument]:
    """Return all rule documents keyed by filename."""

    documents: Dict[str, RuleDocument] = {}
    for path in sorted(RULES_DIR.glob("*.json")):
        data = path.read_bytes()
        payload = json.loads(data.decode("utf-8"))
        documents[path.name] = RuleDocument(
            name=path.name,
            path=path,
            sha256=_compute_sha256(data),
            payload=payload,
            source_url=payload.get("source_url"),
            last_reviewed=payload.get("last_reviewed"),
        )
    return documents


def load_rules_payload(name: str) -> Dict[str, Any]:
    """Return the raw JSON payload for a named rule document."""

    documents = load_rule_documents()
    if name not in documents:
        raise KeyError(f"Unknown rule document: {name}")
    return documents[name].payload


def build_rules_version_payload() -> Dict[str, Any]:
    """Payload for the /rules/version endpoint."""

    documents = load_rule_documents()
    return {
        "rates_version": RATES_VERSION,
        "files": [
            {
                "name": doc.name,
                "sha256": doc.sha256,
                "source_url": doc.source_url,
                "last_reviewed": doc.last_reviewed,
            }
            for doc in sorted(documents.values(), key=lambda d: d.name)
        ],
    }


def validate_known_hashes() -> List[str]:
    """Return a list of human readable mismatch messages."""

    documents = load_rule_documents()
    mismatches: List[str] = []
    expected_files = set(KNOWN_RULE_FILE_HASHES.keys())
    actual_files = set(documents.keys())

    missing_in_expected = actual_files - expected_files
    if missing_in_expected:
        mismatches.append(
            "New rules files detected: " + ", ".join(sorted(missing_in_expected))
        )

    missing_on_disk = expected_files - actual_files
    if missing_on_disk:
        mismatches.append(
            "Rules files missing from disk: " + ", ".join(sorted(missing_on_disk))
        )

    for name, expected_sha in KNOWN_RULE_FILE_HASHES.items():
        doc = documents.get(name)
        if not doc:
            continue
        if doc.sha256 != expected_sha:
            mismatches.append(
                f"Hash mismatch for {name}: expected {expected_sha}, found {doc.sha256}"
            )

    return mismatches


__all__ = [
    "RuleDocument",
    "RULES_DIR",
    "RATES_VERSION",
    "KNOWN_RULE_FILE_HASHES",
    "load_rule_documents",
    "load_rules_payload",
    "build_rules_version_payload",
    "validate_known_hashes",
]
