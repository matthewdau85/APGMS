#!/usr/bin/env python3
"""Ensure tax rule changes bump manifest, constants, and changelog."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RULES_DIR = REPO_ROOT / "apps/services/tax-engine/app/rules"


def run_git(args: list[str]) -> list[str]:
    result = subprocess.run(["git", *args], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def changed_files() -> set[str]:
    files: set[str] = set()
    try:
        files.update(run_git(["diff", "--name-only"]))
    except RuntimeError:
        pass
    try:
        files.update(run_git(["ls-files", "--others", "--exclude-standard"]))
    except RuntimeError:
        pass

    bases: list[str] = []
    try:
        base = subprocess.run(
            ["git", "merge-base", "HEAD", "origin/main"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        if base:
            bases.append(base)
    except subprocess.CalledProcessError:
        pass

    if not bases:
        try:
            base = subprocess.run(["git", "rev-parse", "HEAD^"], capture_output=True, text=True, check=True).stdout.strip()
            if base:
                bases.append(base)
        except subprocess.CalledProcessError:
            return files

    diff_targets = {f"{base}..HEAD" for base in bases}
    for target in diff_targets:
        files.update(run_git(["diff", "--name-only", target]))
    return files


def verify_manifest(manifest_path: Path) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest.get("files", {})
    computed: dict[str, str] = {}
    for name, recorded_sha in files.items():
        rule_path = RULES_DIR / name
        if not rule_path.exists():
            raise SystemExit(f"Manifest references missing file: {name}")
        actual_sha = hashlib.sha256(rule_path.read_bytes()).hexdigest()
        if actual_sha != recorded_sha:
            raise SystemExit(f"SHA mismatch for {name}: manifest={recorded_sha} actual={actual_sha}")
        computed[name] = actual_sha

    payload = json.dumps({k: computed[k] for k in sorted(computed)}, separators=(",", ":"), sort_keys=True).encode()
    composite = hashlib.sha256(payload).hexdigest()
    if composite != manifest.get("composite_sha256"):
        raise SystemExit("Manifest composite_sha256 is out of date")

    constants = (REPO_ROOT / "src/constants/tax.ts").read_text(encoding="utf-8")
    version = manifest.get("version")
    if version and f'"{version}"' not in constants:
        raise SystemExit("src/constants/tax.ts must export the updated RATES_VERSION")


def main() -> None:
    files = changed_files()
    if not files:
        return

    rules_changed = {
        path
        for path in files
        if path.startswith("apps/services/tax-engine/app/rules/") and not path.endswith("manifest.json")
    }
    if not rules_changed:
        return

    required = {
        "apps/services/tax-engine/app/rules/manifest.json",
        "src/constants/tax.ts",
        "apps/services/tax-engine/CHANGELOG.md",
    }
    missing = sorted(required - files)
    if missing:
        print("Tax rules changed. Update the following before committing:", file=sys.stderr)
        for item in missing:
            print(f" - {item}", file=sys.stderr)
        raise SystemExit(1)

    verify_manifest(RULES_DIR / "manifest.json")
    print("Rules drift check passed.")


if __name__ == "__main__":
    main()
