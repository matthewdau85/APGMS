"""Generate GST core rules and Deferred GST scheme mapping."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RULES_DIR = REPO_ROOT / "apps" / "services" / "tax-engine" / "app" / "rules"

GST_SOURCE = "https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst"
DGST_SOURCE = "https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/in-detail/rules-for-specific-transactions/international-transactions/deferred-gst"
LAST_REVIEWED = date.today().isoformat()

def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True))

def main() -> None:
    gst_core = {
        "metadata": {
            "name": "gst_core.json",
            "effective_from": "2000-07-01",
            "effective_to": None,
            "last_reviewed": LAST_REVIEWED,
            "source_url": GST_SOURCE,
        },
        "standard_rate": 0.10,
        "rounding": {
            "method": "nearest_cent",
            "notes": [
                "GST is generally calculated on the taxable supply amount multiplied by 10% and rounded to the nearest cent.",
                "Rounding rules follow ATO guidance: 0.5 rounds up to the next cent.",
            ],
        },
        "accounting_methods": {
            "cash": {
                "description": "Attribute GST on the activity statement when payment is received or made.",
                "bas_labels": {"sales": "G1", "purchases": "G11", "gst_on_sales": "1A", "gst_on_purchases": "1B"},
            },
            "accrual": {
                "description": "Attribute GST on the activity statement when an invoice is issued or received, even if unpaid.",
                "bas_labels": {"sales": "G1", "purchases": "G11", "gst_on_sales": "1A", "gst_on_purchases": "1B"},
            },
        },
        "notes": [
            "Standard GST rate has remained at 10% since introduction on 1 July 2000.",
            "Cash and accrual attribution follow the same BAS labels but differ in timing of attribution.",
            "Deferred GST entries should reference the DGST scheme rules.",
        ],
    }
    dgst = {
        "metadata": {
            "name": "dgst.json",
            "effective_from": "2010-01-01",
            "effective_to": None,
            "last_reviewed": LAST_REVIEWED,
            "source_url": DGST_SOURCE,
        },
        "scheme": "Deferred GST",
        "eligibility": [
            "Importer must be approved for the deferred GST scheme by the ATO.",
            "Customs value of taxable importations reported at label 7 on the BAS.",
            "GST for deferred importations reported at label 1A in the same period.",
        ],
        "bas_mapping": {
            "import_deferred_gst": "7",
            "deferred_gst_payable": "1A",
            "credit_adjustment": "1B",
        },
        "flags": {
            "requires_customs_declaration": True,
            "available_to": "monthly_deferrers",
        },
        "notes": [
            "Deferred GST is reported separately on the BAS: importation value at label 7 and GST payable at label 1A.",
            "Credits for adjustments relating to deferred GST are claimed at label 1B.",
        ],
    }

    write_json(RULES_DIR / "gst_core.json", gst_core)
    write_json(RULES_DIR / "dgst.json", dgst)


if __name__ == "__main__":
    main()
