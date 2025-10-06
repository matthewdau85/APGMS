#!/usr/bin/env python3
"""Ensure tax-engine rules changes bump version and changelog."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "rules_manifest.json"
CHANGELOG = ROOT / "apps" / "services" / "tax-engine" / "CHANGELOG.md"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _git_show(ref: str, path: Path) -> str | None:
    rel = path.relative_to(ROOT).as_posix()
    try:
        return subprocess.check_output(["git", "show", f"{ref}:{rel}"]).decode()
    except subprocess.CalledProcessError:
        return None


def main(base_ref: str) -> int:
    if not MANIFEST.exists():
        print("rules_manifest.json missing", file=sys.stderr)
        return 1
    manifest = json.loads(MANIFEST.read_text())
    rules = manifest.get("rules", [])
    current_hashes = {entry["path"]: entry["sha256"] for entry in rules}

    # Verify manifest matches filesystem
    for entry in rules:
        path = ROOT / entry["path"]
        actual = _sha256(path)
        if actual != entry["sha256"]:
            print(f"Rule hash mismatch for {entry['path']} (manifest {entry['sha256']} actual {actual})", file=sys.stderr)
            return 1

    if not base_ref:
        return 0

    diff_cmd = ["git", "diff", "--name-only", f"{base_ref}...HEAD"]
    changed_paths = subprocess.check_output(diff_cmd).decode().splitlines()
    rules_changed = [p for p in changed_paths if p.startswith("apps/services/tax-engine/app/rules/")]
    if not rules_changed:
        return 0

    if not CHANGELOG.exists():
        print("Tax engine CHANGELOG.md missing", file=sys.stderr)
        return 1

    changelog_text = CHANGELOG.read_text()
    base_manifest_raw = _git_show(base_ref, MANIFEST)
    base_manifest = json.loads(base_manifest_raw) if base_manifest_raw else {}
    if manifest.get("rates_version") == base_manifest.get("rates_version"):
        print("rules_manifest.rates_version must change when rules do", file=sys.stderr)
        return 1

    version = manifest.get("rates_version")
    if not version or f"## {version}" not in changelog_text:
        print(f"CHANGELOG.md must document version {version}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else ""
    raise SystemExit(main(base))
