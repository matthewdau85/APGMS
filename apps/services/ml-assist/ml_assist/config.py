"""Configuration helpers for the ML Assist service."""

from __future__ import annotations

import os
from pathlib import Path


def ml_feature_enabled() -> bool:
    """Return True when ML advisory endpoints are enabled."""
    flag = os.getenv("FEATURE_ML", "true").strip().lower()
    return flag not in {"0", "false", "off", "no"}


def override_store_path() -> Path:
    """Resolve the location where user overrides should be persisted."""
    configured = os.getenv("ML_OVERRIDE_STORE")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parent.parent / "data" / "overrides.json"
