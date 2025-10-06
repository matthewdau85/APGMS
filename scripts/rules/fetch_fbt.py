"""Generate Fringe Benefits Tax rates for the 2024-25 FBT year."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RULES_DIR = REPO_ROOT / "apps" / "services" / "tax-engine" / "app" / "rules"

OUTPUT_PATH = RULES_DIR / "fbt_2024_2025.json"
SOURCE_URL = "https://www.ato.gov.au/tax-rates-and-codes/fringe-benefits-tax-rates-and-thresholds"
LAST_REVIEWED = date.today().isoformat()

def main() -> None:
    data = {
        "metadata": {
            "name": OUTPUT_PATH.relative_to(RULES_DIR).as_posix(),
            "effective_from": "2024-04-01",
            "effective_to": "2025-03-31",
            "last_reviewed": LAST_REVIEWED,
            "source_url": SOURCE_URL,
        },
        "fbt_rate_percent": 47.0,
        "gross_up_factors": {
            "type1": 2.0802,
            "type2": 1.8868,
        },
        "caps": {
            "meal_entertainment_exemption": 2_000,
            "salary_packaging_meal_entertainment_cap": 2_600,
            "remote_area_housing_rebate_percent": 50.0,
        },
        "notes": [
            "FBT year runs from 1 April 2024 to 31 March 2025.",
            "Type 1 gross-up factor applies where the employer can claim GST credits; type 2 applies otherwise.",
            "Salary packaging caps reflect thresholds quoted for not-for-profit and hospital employers.",
        ],
    }
    OUTPUT_PATH.write_text(json.dumps(data, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
