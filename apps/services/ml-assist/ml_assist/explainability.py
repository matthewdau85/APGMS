"""Utilities for logging explainability metadata."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict

LOGGER = logging.getLogger("ml_assist.explainability")


def log_features(channel: str, entity_id: str, features: Dict[str, Any]) -> None:
    """Emit a structured log entry describing model rationale."""
    LOGGER.info("%s %s %s", channel, entity_id, json.dumps(features, sort_keys=True))
