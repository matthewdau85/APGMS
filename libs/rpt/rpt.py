"""Utilities for signing and verifying remittance protection tokens (RPT)."""

from __future__ import annotations

import json
import hmac
import hashlib
import os
import time
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, Union

MoneyLike = Union[int, str, Decimal]


def _key() -> bytes:
    """Derive the shared secret for HMAC signing."""
    k = os.getenv("APGMS_RPT_SECRET", "dev-secret-change-me")
    return k.encode("utf-8")


def _allow_float_inputs() -> bool:
    """Feature flag controlling legacy float handling for money fields."""
    flag = os.getenv("APGMS_RPT_ALLOW_FLOAT_INPUTS", "false").strip().lower()
    return flag in {"1", "true", "yes", "on"}


def _normalize_money(value: MoneyLike, *, allow_float_inputs: bool) -> int:
    """Normalise money-like inputs to integer cents."""

    if isinstance(value, int):
        return value

    if isinstance(value, Decimal):
        cents = (value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        return int(cents)

    if isinstance(value, str):
        try:
            parsed = Decimal(value)
        except InvalidOperation as exc:
            raise ValueError(f"Invalid decimal string for money value: {value!r}") from exc
        return int((parsed * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    if allow_float_inputs and isinstance(value, float):
        # Floats are stringified to avoid binary rounding artefacts.
        return _normalize_money(Decimal(str(value)), allow_float_inputs=False)

    raise TypeError(
        "Money values must be expressed as integer cents, Decimal, or string. "
        "Set APGMS_RPT_ALLOW_FLOAT_INPUTS=1 to coerce float inputs during migration."
    )


def sign(payload: Dict[str, Any]) -> str:
    msg = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hmac.new(_key(), msg, hashlib.sha256).hexdigest()


def verify(payload: Dict[str, Any], signature: str) -> bool:
    try:
        exp = sign(payload)
        return hmac.compare_digest(exp, signature)
    except Exception:
        return False


def build(
    period_id: str,
    paygw_total: MoneyLike,
    gst_total: MoneyLike,
    source_digests: Dict[str, str],
    anomaly_score: float,
    ttl_seconds: int = 3600,
) -> Dict[str, Any]:
    allow_float_inputs = _allow_float_inputs()
    rpt = {
        "period_id": period_id,
        "paygw_total_cents": _normalize_money(paygw_total, allow_float_inputs=allow_float_inputs),
        "gst_total_cents": _normalize_money(gst_total, allow_float_inputs=allow_float_inputs),
        "source_digests": source_digests,
        "anomaly_score": anomaly_score,
        "expires_at": int(time.time()) + int(ttl_seconds),
        "nonce": os.urandom(8).hex(),
    }
    rpt["signature"] = sign(rpt)
    return rpt
