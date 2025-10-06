#!/usr/bin/env python3
"""Generate mock bank payout CSVs with duplicates, late postings, and split payouts."""
from __future__ import annotations

import argparse
import csv
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, time, timezone
from pathlib import Path
from typing import Iterable, List
from uuid import uuid4

UTC = timezone.utc


@dataclass
class PayoutPart:
    line_id: str
    rpt_id: str
    amount_cents: int
    statement_date: datetime
    posted_at: datetime
    description: str
    part: int
    parts: int
    duplicate_of: str | None = None

    def as_row(self) -> dict[str, str]:
        return {
            "line_id": self.line_id,
            "rpt_id": self.rpt_id,
            "amount_cents": str(self.amount_cents),
            "statement_date": self.statement_date.date().isoformat(),
            "posted_at": self.posted_at.isoformat().replace("+00:00", "Z"),
            "description": self.description,
            "part": str(self.part),
            "parts": str(self.parts),
            "duplicate_of": self.duplicate_of or "",
        }


def _floor_to_business_hours(dt: datetime) -> datetime:
    """Ensure anything after Friday 17:00 settles on the following Monday 09:00."""
    if dt.weekday() == 4 and dt.time() >= time(17, 0):
        # move to Monday 09:00 local time
        days_until_monday = 7 - dt.weekday()
        monday = datetime.combine((dt + timedelta(days=days_until_monday)).date(), time(9, 0), tzinfo=dt.tzinfo)
        return monday
    return dt


def _late_posting(base: datetime) -> datetime:
    offset_days = random.randint(-2, 2)
    posted = base + timedelta(days=offset_days, hours=random.randint(0, 6), minutes=random.randint(0, 59))
    return _floor_to_business_hours(posted)


def _split_amount(amount: int, parts: int) -> List[int]:
    base = amount // parts
    remainder = amount % parts
    buckets = [base] * parts
    for idx in range(remainder):
        buckets[idx] += 1
    return buckets


def build_rows(count: int, seed: int | None) -> List[PayoutPart]:
    if seed is not None:
        random.seed(seed)

    start_date = datetime.now(tz=UTC).replace(hour=10, minute=0, second=0, microsecond=0)
    rows: List[PayoutPart] = []

    for idx in range(count):
        rpt_id = f"RPT{idx+1:05d}"
        amount = random.randint(50_00, 250_00)  # cents
        base_day = start_date + timedelta(days=idx)
        statement_date = datetime.combine(base_day.date(), time(0, 0), tzinfo=UTC)
        posted_at = _late_posting(base_day)

        parts = 1
        if random.random() < 0.25:
            parts = random.choice((2, 3))
        amounts = _split_amount(amount, parts)

        for part_no, part_amount in enumerate(amounts, start=1):
            line_id = str(uuid4())
            description = f"RPT payout {rpt_id} part {part_no}/{parts}"
            rows.append(
                PayoutPart(
                    line_id=line_id,
                    rpt_id=rpt_id,
                    amount_cents=part_amount,
                    statement_date=statement_date,
                    posted_at=posted_at,
                    description=description,
                    part=part_no,
                    parts=parts,
                )
            )

    # introduce duplicates (reuse the same line id & rpt) but mark duplicate_of
    if rows:
        dup_samples = random.sample(rows, k=max(1, len(rows) // 5))
        for original in dup_samples:
            duplicate = PayoutPart(
                line_id=original.line_id,
                rpt_id=original.rpt_id,
                amount_cents=original.amount_cents,
                statement_date=original.statement_date,
                posted_at=original.posted_at,
                description=original.description,
                part=original.part,
                parts=original.parts,
                duplicate_of=original.line_id,
            )
            rows.append(duplicate)

    rows.sort(key=lambda p: (p.statement_date, p.rpt_id, p.part, p.duplicate_of is not None))
    return rows


def write_csv(rows: Iterable[PayoutPart], output: Path | None) -> None:
    fieldnames = [
        "line_id",
        "rpt_id",
        "amount_cents",
        "statement_date",
        "posted_at",
        "description",
        "part",
        "parts",
        "duplicate_of",
    ]
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        target = output.open("w", newline="")
        should_close = True
    else:
        import sys

        target = sys.stdout
        should_close = False

    writer = csv.DictWriter(target, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row.as_row())

    if should_close:
        target.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate mock bank payout CSV")
    parser.add_argument("--count", type=int, default=10, help="Number of distinct payouts to generate")
    parser.add_argument("--seed", type=int, help="Seed for deterministic output")
    parser.add_argument("--output", type=Path, help="Optional output file (defaults to stdout)")
    args = parser.parse_args()

    rows = build_rows(args.count, args.seed)
    write_csv(rows, args.output)


if __name__ == "__main__":
    main()
