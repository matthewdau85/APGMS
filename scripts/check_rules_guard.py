#!/usr/bin/env python3
"""Fail when tax rule files change without required metadata updates."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Iterable, Set

REPO_ROOT = Path(__file__).resolve().parents[1]
RULES_PREFIX = Path("apps/services/tax-engine/app/rules")
REQUIRED_FILES = [Path("RATES_VERSION"), Path("CHANGELOG.md")]


def git_diff(args: Iterable[str]) -> Set[str]:
    cmd = ["git", "diff", "--name-only", *args]
    proc = subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if proc.returncode not in (0, 1):
        return set()
    return {line.strip() for line in proc.stdout.splitlines() if line.strip()}


def git_rev_parse(ref: str) -> bool:
    proc = subprocess.run(
        ["git", "rev-parse", "--verify", ref],
        cwd=REPO_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return proc.returncode == 0


def collect_changed_files() -> Set[str]:
    changed: Set[str] = set()
    changed |= git_diff(["--cached"])
    changed |= git_diff([])
    for remote_ref in ("origin/main", "origin/master"):
        if git_rev_parse(remote_ref):
            changed |= git_diff([f"{remote_ref}...HEAD"])
            break
    else:
        if git_rev_parse("HEAD^"):
            changed |= git_diff(["HEAD^", "HEAD"])
    return changed


def main() -> int:
    changed_files = collect_changed_files()
    rules_changes = {
        path for path in changed_files if Path(path).is_relative_to(RULES_PREFIX)
    }
    if not rules_changes:
        return 0

    missing = [str(req) for req in REQUIRED_FILES if str(req) not in changed_files]
    if missing:
        sys.stderr.write(
            "Tax rule change detected in:\n  - "
            + "\n  - ".join(sorted(rules_changes))
            + "\nRequired files not updated: "
            + ", ".join(missing)
            + "\n"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
