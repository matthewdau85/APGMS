#!/usr/bin/env python3
"""Utility to update key/value pairs in a dotenv-style file."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Dict


def parse_updates(pairs: list[str]) -> Dict[str, str]:
    updates: Dict[str, str] = {}
    for pair in pairs:
        if "=" not in pair:
            raise argparse.ArgumentTypeError(f"Invalid key/value pair: {pair!r}")
        key, value = pair.split("=", 1)
        if not key:
            raise argparse.ArgumentTypeError(f"Empty key in pair: {pair!r}")
        updates[key] = value
    return updates


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("env_file", help="Path to the environment file to update")
    parser.add_argument(
        "pairs",
        nargs="+",
        help="Key/value pairs in KEY=VALUE format to upsert into the env file",
    )
    args = parser.parse_args()

    env_path = Path(args.env_file)
    updates = parse_updates(args.pairs)

    existing_lines: list[str] = []
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                existing_lines.append(line)
                continue
            key, sep, value = line.partition("=")
            if sep and key in updates:
                continue
            existing_lines.append(line)

    env_path.write_text(
        "\n".join(existing_lines + [f"{k}={v}" for k, v in updates.items()]) + "\n"
    )


if __name__ == "__main__":
    main()
