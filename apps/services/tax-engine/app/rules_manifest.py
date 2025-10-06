from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Mapping

RULES_DIR = Path(__file__).resolve().parent / "rules"


@lru_cache(maxsize=1)
def get_manifest() -> Mapping[str, object]:
    with (RULES_DIR / "rules_manifest.json").open("r", encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def get_bas_labels() -> Mapping[str, Mapping[str, str]]:
    with (RULES_DIR / "bas_labels.json").open("r", encoding="utf-8") as fh:
        return json.load(fh)
