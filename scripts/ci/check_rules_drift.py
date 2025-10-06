#!/usr/bin/env python3
"""Fail CI if tax rules drift without version and changelog updates."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable, Set

ROOT = Path(__file__).resolve().parents[2]
RULES_DIR = ROOT / "apps" / "services" / "tax-engine" / "app" / "rules"
RULES_PREFIX = "apps/services/tax-engine/app/rules/"
MANIFEST_PATH = RULES_DIR / "manifest.json"
CHANGELOG_PATH = ROOT / "CHANGELOG.md"
RATES_FILE = ROOT / "apps/services/tax-engine/app/__init__.py"


def _run_git(args: Iterable[str]) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()


def _working_tree_changes() -> Set[str]:
    status = _run_git(["status", "--porcelain"])
    files: Set[str] = set()
    for line in status.splitlines():
        if not line:
            continue
        files.add(line[3:].strip())
    return files


def _changed_files() -> Set[str]:
    candidates = []
    base_ref = os.environ.get("GITHUB_BASE_REF")
    if base_ref:
        candidates.append(f"origin/{base_ref}...HEAD")
    candidates.append("origin/main...HEAD")
    candidates.append("HEAD^...HEAD")
    seen: Set[str] = set()
    for ref in candidates:
        try:
            diff = _run_git(["diff", "--name-only", ref])
        except RuntimeError:
            continue
        if diff:
            seen.update(line.strip() for line in diff.splitlines() if line.strip())
        if seen:
            return seen
    return _working_tree_changes()


def _read_manifest() -> dict:
    with MANIFEST_PATH.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    return manifest


def _hash_matches(manifest: dict) -> bool:
    for entry in manifest.get("files", []):
        file_path = RULES_DIR / entry["name"]
        if not file_path.exists():
            return False
        data = file_path.read_bytes()
        import hashlib

        digest = hashlib.sha256(data).hexdigest()
        if digest != entry.get("sha256"):
            return False
    return True


def _parse_rates_version(path: Path) -> str:
    content = path.read_text(encoding="utf-8")
    match = re.search(r"RATES_VERSION\s*=\s*\"([^\"]+)\"", content)
    if not match:
        raise RuntimeError("RATES_VERSION not found")
    return match.group(1)


def _previous_rates_version() -> str:
    try:
        stdout = _run_git(["show", f"HEAD:{RATES_FILE.relative_to(ROOT)}"])
    except RuntimeError:
        return ""
    match = re.search(r"RATES_VERSION\s*=\s*\"([^\"]+)\"", stdout)
    if not match:
        return ""
    return match.group(1)


def main() -> int:
    changed = _changed_files()
    changed_rules = {f for f in changed if f.startswith(RULES_PREFIX) and f != f"{RULES_PREFIX}manifest.json"}
    if not changed_rules:
        return 0

    if f"{RULES_PREFIX}manifest.json" not in changed:
        print("::error ::Tax rule change detected but manifest.json was not regenerated", file=sys.stderr)
        return 1

    manifest = _read_manifest()
    if manifest.get("version") != _parse_rates_version(RATES_FILE):
        print("::error ::Manifest version does not match RATES_VERSION", file=sys.stderr)
        return 1

    if not _hash_matches(manifest):
        print("::error ::Manifest hashes are stale; run build_manifest.py", file=sys.stderr)
        return 1

    previous_version = _previous_rates_version()
    current_version = _parse_rates_version(RATES_FILE)
    if previous_version == current_version:
        print("::error ::Tax rules changed without bumping RATES_VERSION", file=sys.stderr)
        return 1

    if not CHANGELOG_PATH.exists() or str(CHANGELOG_PATH) not in changed:
        print("::error ::CHANGELOG.md must describe tax rules update", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"::error ::{exc}", file=sys.stderr)
        raise SystemExit(1)
