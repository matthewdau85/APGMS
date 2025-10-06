#!/usr/bin/env python3
"""Verify migration checksums match the manifest."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "migrations" / "manifest.json"
MIGRATIONS_DIR = ROOT / "migrations"


def sha256sum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    if not MANIFEST_PATH.exists():
        print("migration manifest missing", file=sys.stderr)
        return 1
    manifest = json.loads(MANIFEST_PATH.read_text())
    expected = {entry["path"]: entry["sha256"] for entry in manifest.get("migrations", [])}
    missing = []
    for sql in sorted(MIGRATIONS_DIR.glob("*.sql")):
        rel = str(sql.relative_to(ROOT))
        digest = sha256sum(sql)
        recorded = expected.get(rel)
        if recorded is None:
            missing.append(rel)
            continue
        if recorded != digest:
            print(f"Checksum mismatch for {rel}: manifest {recorded}, actual {digest}", file=sys.stderr)
            return 1
    if missing:
        print(f"Migrations missing from manifest: {', '.join(missing)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
