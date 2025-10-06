#!/usr/bin/env python3
"""Generate curated PAYG-W rules from authoritative CSV inputs."""
from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import List

REPO_ROOT = Path(__file__).resolve().parents[2]
RULES_DIR = REPO_ROOT / "apps/services/tax-engine/app/rules"

@dataclass
class Dataset:
    name: str
    csv_path: Path
    version: str
    period: str
    source_url: str
    last_reviewed: str
    notes: str

    def brackets(self) -> List[dict]:
        rows: List[dict] = []
        with self.csv_path.open("r", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                up_to = Decimal(row["up_to"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                a = Decimal(row["a"]).quantize(Decimal("0.000"))
                b = Decimal(row["b"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                fixed = Decimal(row["fixed"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                rows.append(
                    {
                        "up_to": float(up_to),
                        "a": float(a),
                        "b": float(b),
                        "fixed": float(fixed),
                    }
                )
        rows.sort(key=lambda item: item["up_to"])
        return rows

DATASETS: List[Dataset] = [
    Dataset(
        name="payg_w_2024_25",
        csv_path=Path(__file__).with_name("data") / "payg_w_2024_25.csv",
        version="2024-25",
        period="weekly",
        source_url="https://www.ato.gov.au/rates/tax-tables/weekly-tax-table",
        last_reviewed=date(2024, 10, 1).isoformat(),
        notes="Generated from the ATO weekly tax table for income year 2024-25.",
    ),
]

RULES_DIR.mkdir(parents=True, exist_ok=True)

METHODS_ENABLED = [
    "table_ato",
    "formula_progressive",
    "percent_simple",
    "flat_plus_percent",
    "bonus_marginal",
    "net_to_gross",
]


def main() -> None:
    for dataset in DATASETS:
        brackets = dataset.brackets()
        payload = {
            "version": dataset.version,
            "notes": dataset.notes,
            "metadata": {
                "source_url": dataset.source_url,
                "last_reviewed": dataset.last_reviewed,
            },
            "methods_enabled": METHODS_ENABLED,
            "formula_progressive": {
                "period": dataset.period,
                "brackets": brackets,
                "tax_free_threshold": True,
                "rounding": "HALF_UP",
            },
        }
        output_path = RULES_DIR / f"{dataset.name}.json"
        with output_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        print(f"Updated {output_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
