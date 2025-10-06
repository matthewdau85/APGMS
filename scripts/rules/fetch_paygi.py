"""Generate PAYG instalment GDP uplift rules for 2024-25."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RULES_DIR = REPO_ROOT / "apps" / "services" / "tax-engine" / "app" / "rules"

OUTPUT_PATH = RULES_DIR / "paygi_gdp_uplift_2024_25.json"
SOURCE_URL = "https://softwaredevelopers.ato.gov.au/gdp-adjustment-2024-25-gst-and-payg-instalments"
LAST_REVIEWED = date.today().isoformat()

def main() -> None:
    data = {
        "metadata": {
            "name": OUTPUT_PATH.relative_to(RULES_DIR).as_posix(),
            "effective_from": "2024-07-01",
            "effective_to": "2025-06-30",
            "last_reviewed": LAST_REVIEWED,
            "source_url": SOURCE_URL,
        },
        "gdp_uplift_factor": 0.06,
        "notes": [
            "ATO advised GDP uplift factor for 2024-25 PAYG instalments and GST instalments is 6%.",
            "Factor applies to entities using GDP-adjusted instalment calculations for quarters ending 30 September 2024 through 30 June 2025.",
        ],
    }
    OUTPUT_PATH.write_text(json.dumps(data, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
