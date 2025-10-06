#!/usr/bin/env python3
"""Gate changes to tax rules to ensure manifest, version and changelog stay in sync."""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
from typing import Iterable, List

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
RULES_DIR = REPO_ROOT / "apps/services/tax-engine/app/rules"
MANIFEST_PATH = RULES_DIR / "manifest.json"
TAX_CONSTANTS_PATH = REPO_ROOT / "src/constants/tax.ts"
CHANGELOG_PATH = REPO_ROOT / "CHANGELOG.md"


class DriftError(RuntimeError):
    pass


def _git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True)


def _resolve_base_ref() -> str | None:
    candidates: Iterable[str | None] = (
        os.environ.get("RULES_DRIFT_BASE"),
        "origin/main",
        "origin/master",
        "main",
        "master",
        "HEAD^",
    )
    for candidate in candidates:
        if not candidate:
            continue
        try:
            _git("rev-parse", candidate)
            return candidate
        except subprocess.CalledProcessError:
            continue
    return None


def changed_files() -> List[str]:
    base = _resolve_base_ref()
    if base:
        diff = _git("diff", "--name-only", f"{base}...HEAD").stdout
    else:
        diff = _git("status", "--porcelain").stdout
        diff = "\n".join(line[3:] for line in diff.splitlines() if line)
    return [line.strip() for line in diff.splitlines() if line.strip()]


def compute_snapshot() -> dict:
    files = sorted(p for p in RULES_DIR.glob("*.json") if p.name != "manifest.json")
    per_file: dict[str, str] = {}
    for file in files:
        sha = hashlib.sha256(file.read_bytes()).hexdigest()
        per_file[file.name] = sha
    aggregate = "".join(f"{name}:{sha}\n" for name, sha in sorted(per_file.items()))
    manifest_sha = hashlib.sha256(aggregate.encode("utf-8")).hexdigest()
    return {"files": per_file, "sha256": manifest_sha}


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        raise DriftError("rules manifest missing")
    return json.loads(MANIFEST_PATH.read_text())


def extract_rates_version() -> str:
    if not TAX_CONSTANTS_PATH.exists():
        raise DriftError("src/constants/tax.ts missing")
    text = TAX_CONSTANTS_PATH.read_text()
    match = re.search(r"RATES_VERSION\s*=\s*\"([^\"]+)\"", text)
    if not match:
        raise DriftError("RATES_VERSION constant not found in src/constants/tax.ts")
    return match.group(1)


def ensure_changelog_entry(changed: List[str]) -> None:
    if "CHANGELOG.md" not in changed:
        raise DriftError("rules changed but CHANGELOG.md was not updated")
    if not CHANGELOG_PATH.exists():
        raise DriftError("CHANGELOG.md missing")
    text = CHANGELOG_PATH.read_text().strip()
    if not text:
        raise DriftError("CHANGELOG.md is empty")


def main() -> int:
    changed = changed_files()
    rules_changed = [f for f in changed if f.startswith("apps/services/tax-engine/app/rules/") and f.endswith(".json") and pathlib.Path(f).name != "manifest.json"]
    manifest_changed = "apps/services/tax-engine/app/rules/manifest.json" in changed
    constants_changed = "src/constants/tax.ts" in changed

    snapshot = compute_snapshot()
    manifest = load_manifest()
    version = extract_rates_version()

    if rules_changed:
        missing: List[str] = []
        if not manifest_changed:
            missing.append("rules manifest")
        if not constants_changed:
            missing.append("RATES_VERSION")
        try:
            ensure_changelog_entry(changed)
        except DriftError as exc:
            missing.append(str(exc))
        if missing:
            raise DriftError("Tax rules changed but required updates missing: " + ", ".join(missing))

    if not rules_changed and manifest_changed:
        raise DriftError("Rules manifest updated without changing underlying rules")

    if manifest.get("sha256") != snapshot["sha256"] or manifest.get("files") != snapshot["files"]:
        raise DriftError("Manifest sha256/files do not match current rules contents")

    if manifest.get("version") != version:
        raise DriftError(f"Manifest version {manifest.get('version')} does not match RATES_VERSION {version}")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except DriftError as err:
        print(f"rules drift check failed: {err}", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as err:
        print(f"git command failed: {err}", file=sys.stderr)
        sys.exit(1)
