#!/usr/bin/env python3
"""Build a manifest of tax rules including per-file SHA-256 hashes."""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
TAX_ENGINE_PATH = ROOT / "apps" / "services" / "tax-engine"
if str(TAX_ENGINE_PATH) not in sys.path:
    sys.path.insert(0, str(TAX_ENGINE_PATH))

try:
    from app import RATES_VERSION
except Exception as exc:  # pragma: no cover - defensive
    raise SystemExit(f"Unable to import tax engine (RATES_VERSION): {exc}")

RULES_DIR = TAX_ENGINE_PATH / "app" / "rules"
MANIFEST_PATH = RULES_DIR / "manifest.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    if not RULES_DIR.exists():
        raise SystemExit(f"Rules directory not found: {RULES_DIR}")

    entries = []
    for rules_file in sorted(RULES_DIR.glob("*.json")):
        if rules_file.name == "manifest.json":
            continue
        entries.append({
            "name": rules_file.name,
            "sha256": sha256_file(rules_file)
        })

    now = _dt.datetime.now(_dt.timezone.utc)
    manifest = {
        "version": RATES_VERSION,
        "generated_at": now.isoformat(),
        "files": entries,
    }

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
