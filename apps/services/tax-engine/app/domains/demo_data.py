from __future__ import annotations

from typing import Dict, List, Tuple

PayrollKey = Tuple[str, str]
GSTKey = Tuple[str, str]

PAYROLL_RUNS: Dict[PayrollKey, List[Dict]] = {
    ("12345678901", "2025-09"): [
        {"gross_cents": 180_000, "period": "weekly", "flags": {"tax_free_threshold": True}},
        {"gross_cents": 320_000, "period": "weekly", "flags": {"tax_free_threshold": True}},
        {"gross_cents": 520_000, "period": "weekly", "flags": {"tax_free_threshold": True}},
    ]
}

GST_JOURNALS: Dict[GSTKey, Dict[str, List[Dict]]] = {
    ("12345678901", "2025-09"): {
        "sales": [
            {"net_cents": 800_000, "tax_code": "GST"},
            {"net_cents": 434_560, "tax_code": "GST"},
            {"net_cents": 120_000, "tax_code": "GST_FREE"}
        ],
        "purchases": [
            {"net_cents": 200_000, "tax_code": "GST"},
            {"net_cents": 150_000, "tax_code": "INPUT_TAXED"}
        ]
    }
}
