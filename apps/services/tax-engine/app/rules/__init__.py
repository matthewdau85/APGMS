from __future__ import annotations

import json
import hashlib
from pathlib import Path
from typing import Any, Dict

RATES_VERSION = "2024-25.v1"

_BASE_DIR = Path(__file__).resolve().parent


def _load_json(relative_path: str) -> Dict[str, Any]:
    path = _BASE_DIR / relative_path
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_payg_rules(period: str) -> Dict[str, Any]:
    period_file = {
        "weekly": "payg_w_2024_25/weekly.json",
        "fortnightly": "payg_w_2024_25/fortnightly.json",
        "monthly": "payg_w_2024_25/monthly.json",
        "quarterly": "payg_w_2024_25/quarterly.json",
    }.get(period)
    if not period_file:
        raise ValueError(f"Unsupported PAYG period '{period}'")
    return _load_json(period_file)


def load_gst_rules() -> Dict[str, Any]:
    return _load_json("gst_core.json")


def load_bas_labels() -> Dict[str, Any]:
    return _load_json("bas_labels.json").get("mappings", {})


def build_rules_manifest() -> Dict[str, Dict[str, str]]:
    manifest: Dict[str, Dict[str, str]] = {}
    for json_path in sorted(_BASE_DIR.glob("**/*.json")):
        relative = json_path.relative_to(_BASE_DIR)
        sha256 = hashlib.sha256(json_path.read_bytes()).hexdigest()
        manifest[str(relative)] = {
            "sha256": sha256,
            "effective_from": "2024-07-01",
            "effective_to": "2025-06-30",
        }
    return manifest


RULES_MANIFEST = build_rules_manifest()
