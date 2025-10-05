# libs/rpt/rpt.py
import base64
import json
import os
import time
from typing import Any, Dict

from nacl.exceptions import BadSignatureError
from nacl.signing import SigningKey, VerifyKey

_DEFAULT_SECRET_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="


def _pad_b64(value: str) -> str:
    value = value.strip()
    remainder = len(value) % 4
    if remainder:
        value += "=" * (4 - remainder)
    return value


def _load_signing_key() -> SigningKey:
    b64 = (
        os.getenv("RPT_ED25519_SECRET_BASE64")
        or os.getenv("APGMS_RPT_ED25519_SECRET_BASE64")
        or _DEFAULT_SECRET_B64
    )
    raw = base64.b64decode(_pad_b64(b64))
    if len(raw) == 64:
        raw = raw[:32]
    if len(raw) != 32:
        raise ValueError("Ed25519 secret key must be 32 or 64 bytes")
    return SigningKey(raw)


def _load_verify_key() -> VerifyKey:
    b64 = os.getenv("RPT_PUBLIC_BASE64") or os.getenv("APGMS_RPT_PUBLIC_BASE64")
    if b64:
        raw = base64.b64decode(_pad_b64(b64))
        if len(raw) != 32:
            raise ValueError("Ed25519 public key must be 32 bytes")
        return VerifyKey(raw)
    return _load_signing_key().verify_key


def _canonical(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _canonical(value[k]) for k in sorted(value.keys())}
    if isinstance(value, list):
        return [_canonical(v) for v in value]
    return value


def canonical_json(payload: Dict[str, Any]) -> str:
    ordered = _canonical(payload)
    return json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))


def sign(payload: Dict[str, Any]) -> str:
    msg = canonical_json(payload).encode("utf-8")
    sig = _load_signing_key().sign(msg).signature
    return base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")


def verify(payload: Dict[str, Any], signature: str) -> bool:
    try:
        msg = canonical_json(payload).encode("utf-8")
        sig = base64.urlsafe_b64decode(_pad_b64(signature))
        _load_verify_key().verify(msg, sig)
        return True
    except (BadSignatureError, ValueError):
        return False


def build(
    period_id: str,
    paygw_total: float,
    gst_total: float,
    source_digests: Dict[str, str],
    anomaly_score: float,
    ttl_seconds: int = 3600,
) -> Dict[str, Any]:
    rpt = {
        "period_id": period_id,
        "paygw_total": round(paygw_total, 2),
        "gst_total": round(gst_total, 2),
        "source_digests": source_digests,
        "anomaly_score": anomaly_score,
        "expires_at": int(time.time()) + ttl_seconds,
        "nonce": os.urandom(8).hex(),
    }
    payload = {k: v for k, v in rpt.items()}
    rpt["signature"] = sign(payload)
    return rpt
