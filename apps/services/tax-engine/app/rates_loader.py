from __future__ import annotations

import argparse
from pathlib import Path
from typing import Sequence

from .rates_repository import DEFAULT_STORAGE_PATH, RatesRepository, ingest_csv


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Load PAYGW/GST rates from an ATO CSV dump.")
    parser.add_argument("csv", metavar="CSV", help="Path to the CSV file containing the rates table.")
    parser.add_argument(
        "--output",
        "-o",
        metavar="PATH",
        help=f"Destination rates_versions.json (defaults to {DEFAULT_STORAGE_PATH}).",
    )
    parser.add_argument(
        "--source",
        metavar="LABEL",
        help="Optional source label stored with the version metadata.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    csv_path = Path(args.csv)
    if not csv_path.exists():
        parser.error(f"CSV file not found: {csv_path}")

    repo = RatesRepository(args.output) if args.output else RatesRepository()
    version_ids = ingest_csv(csv_path, repo=repo, source=args.source)
    if version_ids:
        print(f"Loaded {len(version_ids)} rates_version row(s): {', '.join(version_ids)}")
    else:
        print("No rate rows were ingested from the CSV.")
    print(f"Rates stored at: {repo.storage_path}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
