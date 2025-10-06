from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

DATA_DIR = Path(__file__).resolve().parent / "data" / "periods"


def load_period_payload(abn: str, period_id: str) -> Dict[str, Any]:
    path = DATA_DIR / f"{abn}_{period_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"No tax period data for {abn} {period_id}")
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)
