#!/usr/bin/env python3
"""Compute SHA-256 digests for tax rule payloads."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Iterable, List, Tuple

REPO_ROOT = Path(__file__).resolve().parents[1]
# Directories that contain authoritative tax rule data files.
RULE_DIRECTORIES = [
    REPO_ROOT / "apps" / "services" / "tax-engine" / "app" / "rules",
]
SUPPORTED_SUFFIXES = {".json", ".yaml", ".yml"}


def iter_rule_files() -> Iterable[Path]:
    """Yield all rule files beneath the configured directories."""
    for rules_dir in RULE_DIRECTORIES:
        if not rules_dir.exists():
            continue
        for path in sorted(rules_dir.rglob("*")):
            if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES:
                yield path


def sha256_digest(path: Path) -> str:
    data = path.read_bytes()
    return hashlib.sha256(data).hexdigest()


def build_records() -> List[Tuple[Path, str]]:
    records: List[Tuple[Path, str]] = []
    for file_path in iter_rule_files():
        records.append((file_path.relative_to(REPO_ROOT), sha256_digest(file_path)))
    return records


def as_table(records: List[Tuple[Path, str]]) -> str:
    if not records:
        return "No rule files found."
    max_len = max(len(str(path)) for path, _ in records)
    lines = []
    header = f"{'Rule file'.ljust(max_len)}  SHA-256"
    lines.append(header)
    lines.append(f"{'-' * max_len}  {'-' * 64}")
    for path, digest in records:
        lines.append(f"{str(path).ljust(max_len)}  {digest}")
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit JSON instead of a text table.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output (implies --json).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    records = build_records()
    if args.json or args.pretty:
        payload = {
            "rule_files": [
                {"path": str(path), "sha256": digest} for path, digest in records
            ],
        }
        indent = 2 if args.pretty else None
        print(json.dumps(payload, indent=indent))
        return 0
    print(as_table(records))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
