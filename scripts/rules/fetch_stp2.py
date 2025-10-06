"""Generate STP Phase 2 earning code mappings and BAS label definitions."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RULES_DIR = REPO_ROOT / "apps" / "services" / "tax-engine" / "app" / "rules"

STP_SOURCE = "https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/single-touch-payroll/in-detail/single-touch-payroll-phase-2-employer-reporting-guidelines"
GST_SOURCE = "https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst"
LAST_REVIEWED = date.today().isoformat()

def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True))

def main() -> None:
    stp2 = {
        "metadata": {
            "name": "stp2_mapping.json",
            "effective_from": "2022-01-01",
            "effective_to": None,
            "last_reviewed": LAST_REVIEWED,
            "source_url": STP_SOURCE,
        },
        "earnings_codes": [
            {
                "code": "SALARY",
                "description": "Ordinary time earnings (salary and wages)",
                "bas_labels": ["W1"],
                "stp_income_stream_type": "SAW",
            },
            {
                "code": "ALLOWANCE-CAR",
                "description": "Allowance - cents per kilometre",
                "bas_labels": ["W1"],
                "stp_income_stream_type": "SAW",
            },
            {
                "code": "ALLOWANCE-OTHER",
                "description": "Allowance - other taxable",
                "bas_labels": ["W1"],
                "stp_income_stream_type": "SAW",
            },
            {
                "code": "EMPLOYER-SUPER",
                "description": "Employer superannuation contributions",
                "bas_labels": ["W1"],
                "stp_income_stream_type": "SUP",
            },
            {
                "code": "ETP-T",
                "description": "Eligible termination payment (taxable component)",
                "bas_labels": ["W1", "W2"],
                "stp_income_stream_type": "ETP",
            },
            {
                "code": "ETP-R",
                "description": "Eligible termination payment (rolled-over component)",
                "bas_labels": ["W1"],
                "stp_income_stream_type": "ETP",
            },
        ],
        "rfba_reporting": {
            "threshold": 2_000,
            "stp_income_stream_type": "RFBA",
            "payment_summary_label": "RFBA",
            "notes": [
                "Reportable fringe benefits amounts above $2,000 must be disclosed with RFBA income type in STP phase 2.",
                "RFBA totals map to payment summary label RFBA and do not contribute to W1/W2 on the BAS.",
            ],
        },
        "withholding_mapping": {
            "w1_includes": ["SALARY", "ALLOWANCE-CAR", "ALLOWANCE-OTHER", "EMPLOYER-SUPER", "ETP-T", "ETP-R"],
            "w2_includes": ["ETP-T"],
        },
    }

    bas_labels = {
        "metadata": {
            "name": "bas_labels.json",
            "effective_from": "2024-07-01",
            "effective_to": None,
            "last_reviewed": LAST_REVIEWED,
            "source_url": GST_SOURCE,
        },
        "labels": {
            "G1": "Total sales",
            "G2": "Export sales",
            "G3": "Other GST-free sales",
            "G10": "Capital purchases",
            "G11": "Non-capital purchases",
            "W1": "Total salary, wages and other payments",
            "W2": "Amounts withheld from payments shown at W1",
            "1A": "GST on sales",
            "1B": "GST on purchases",
            "F1": "PAYG income tax instalment",
            "F2": "PAYG income tax instalment credits",
            "T1": "PAYG withholding where no ABN is quoted",
            "T2": "PAYG withholding for payments to foreign residents",
            "T3": "PAYG withholding from investment income payments",
            "T4": "PAYG withholding from superannuation income streams",
        },
        "notes": [
            "BAS labels align to the standard Business Activity Statement instructions for GST and PAYG withholding.",
            "Label descriptions support mapping outputs for the tax engine.",
        ],
    }

    write_json(RULES_DIR / "stp2_mapping.json", stp2)
    write_json(RULES_DIR / "bas_labels.json", bas_labels)


if __name__ == "__main__":
    main()
