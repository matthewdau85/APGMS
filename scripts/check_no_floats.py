#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCAN_ROOTS = [
    ROOT / "src" / "routes",
    ROOT / "src" / "api",
    ROOT / "src" / "rails",
    ROOT / "libs",
    ROOT / "tests",
    ROOT / "pages" / "api",
    ROOT / "apps" / "services" / "tax-engine",
]
TARGET_EXTENSIONS = {".ts", ".tsx", ".js", ".py"}
EXCLUDE_DIRS = {"node_modules", "__pycache__", "dist", "build", ".git", ".venv"}
FLOAT_PATTERN = re.compile(r"(?<![\"'])\b\d+\.\d+\b(?![\"'])")
KEYWORDS = ("amount", "_cents", "balance", "money", "penalty", "liability", "owed")


def should_scan(path: Path) -> bool:
    if path.suffix not in TARGET_EXTENSIONS:
        return False
    for parent in path.parents:
        if parent.name in EXCLUDE_DIRS:
            return False
    return True


def main() -> int:
    violations: list[str] = []
    for base in SCAN_ROOTS:
        if not base.exists():
            continue
        for file in base.rglob("*"):
            if not should_scan(file):
                continue
            text = file.read_text(encoding="utf-8", errors="ignore")
            for idx, line in enumerate(text.splitlines(), start=1):
                for match in FLOAT_PATTERN.finditer(line):
                    window = line[max(0, match.start() - 40): match.end() + 40].lower()
                    if any(k in window for k in KEYWORDS):
                        violations.append(f"{file.relative_to(ROOT)}:{idx}: {line.strip()}")
                        break
    if violations:
        print("Floating point literal usage detected in money-sensitive code:", file=sys.stderr)
        for v in violations:
            print(v, file=sys.stderr)
        print("Use integer cents helpers instead.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
