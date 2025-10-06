"""Canonical versioning for published tax rules."""
from __future__ import annotations

from typing import Dict

# Update this version whenever any document in ``app/rules`` changes.
RATES_VERSION: str = "2025-10-05.0"

# Expected SHA-256 digests for each rules file. The CI test ensures these stay in sync
# with :data:`RATES_VERSION` and that a changelog entry exists for the current version.
KNOWN_RULE_FILE_HASHES: Dict[str, str] = {
    "calendars.json": "51b38a2c887067e45ccec5892cb2bd302aa767df30973c63348822e0c019b216",
    "payg_w_2024_25.json": "663081afecf48c5eefa12b88c13a61d74ecd7c292fb5af12d44220cf75f23d91",
}

__all__ = ["RATES_VERSION", "KNOWN_RULE_FILE_HASHES"]
