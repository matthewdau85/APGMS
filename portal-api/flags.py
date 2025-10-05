from __future__ import annotations

"""Shared prototype feature flag helpers for the portal API."""

from dataclasses import asdict, dataclass
import logging
import os
from typing import Dict

logger = logging.getLogger(__name__)

_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}
_warned_invalid: set[str] = set()


def _parse_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default

    normalized = raw.strip().lower()
    if normalized in _TRUE_VALUES:
        return True
    if normalized in _FALSE_VALUES:
        return False

    if name not in _warned_invalid:
        logger.warning("[flags] Ignoring invalid boolean for %s: %s", name, raw)
        _warned_invalid.add(name)
    return default


@dataclass(frozen=True)
class ProtoFlags:
    PROTO_KILL_SWITCH: bool
    PROTO_ENABLE_IDEMPOTENCY: bool
    PROTO_ENABLE_RPT: bool
    PROTO_BLOCK_ON_ANOMALY: bool
    PROTO_ALLOW_OVERRIDES: bool
    PROTO_ENABLE_REAL_BANK: bool


def get_proto_flags() -> ProtoFlags:
    return ProtoFlags(
        PROTO_KILL_SWITCH=_parse_bool("PROTO_KILL_SWITCH", True),
        PROTO_ENABLE_IDEMPOTENCY=_parse_bool("PROTO_ENABLE_IDEMPOTENCY", False),
        PROTO_ENABLE_RPT=_parse_bool("PROTO_ENABLE_RPT", True),
        PROTO_BLOCK_ON_ANOMALY=_parse_bool("PROTO_BLOCK_ON_ANOMALY", False),
        PROTO_ALLOW_OVERRIDES=_parse_bool("PROTO_ALLOW_OVERRIDES", False),
        PROTO_ENABLE_REAL_BANK=_parse_bool("PROTO_ENABLE_REAL_BANK", False),
    )


def get_proto_flags_dict() -> Dict[str, bool]:
    """Return the current flag snapshot as a serialisable dictionary."""

    return asdict(get_proto_flags())


def is_proto_kill_switch_enabled() -> bool:
    return get_proto_flags().PROTO_KILL_SWITCH


PROTOTYPE_KILL_SWITCH_MESSAGE = "Prototype mode: egress disabled"
