#!/usr/bin/env python3
"""Fail the commit if newly staged code introduces float literals."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

FLOAT_PATTERN = re.compile(r"(?<![\w\"'])\d+\.\d+(?:[eE][+-]?\d+)?(?![\w\"'])")
CHECK_EXTS = {".py", ".pyi", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".ps1"}


def staged_diff() -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--cached", "--unified=0", "--diff-filter=ACMRTUXB"],
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    )
    return result.stdout.splitlines()


def should_check(path: str) -> bool:
    return Path(path).suffix in CHECK_EXTS


def main() -> int:
    diff_lines = staged_diff()
    current_path: str | None = None
    violations: list[tuple[str, str]] = []

    for raw in diff_lines:
        if raw.startswith("+++ b/"):
            current_path = raw[6:]
            continue
        if not current_path or not should_check(current_path):
            continue
        if not raw.startswith("+") or raw.startswith("+++"):
            continue
        line = raw[1:]
        match = FLOAT_PATTERN.search(line)
        if match:
            violations.append((current_path, line.rstrip()))

    if violations:
        sys.stderr.write("Float literals detected in staged changes:\n")
        for path, line in violations:
            sys.stderr.write(f"  {path}: {line}\n")
        sys.stderr.write("Use integers, Decimal, or rationals instead of floats.\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
