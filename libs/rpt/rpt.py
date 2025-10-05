"""RPT signing helpers.

This module now produces compact JWS tokens (RS256) that wrap the
reconciliation payload.  The helpers expose a deterministic canonical JSON
encoding so other services (Node, TypeScript) can share the same
representation when computing payload hashes.
"""

import json
import os
import time
import uuid
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional, Tuple

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey, RSAPublicKey

__all__ = [
    "build",
    "sign",
    "verify",
    "decode",
    "canonical_json",
    "ReplayError",
    "SignatureError",
    "TokenExpiredError",
]


class RptError(RuntimeError):
    """Base class for RPT errors."""


class SignatureError(RptError):
    """Raised when the JWS signature is invalid."""


class TokenExpiredError(RptError):
    """Raised when a token has expired."""


class ReplayError(RptError):
    """Raised when a token JTI has already been observed."""


_private_key: Optional[RSAPrivateKey] = None
_public_key: Optional[RSAPublicKey] = None


def _load_private_key() -> RSAPrivateKey:
    global _private_key
    if _private_key is not None:
        return _private_key
    pem = os.getenv("APGMS_RPT_PRIVATE_KEY_PEM")
    if not pem:
        raise RuntimeError("APGMS_RPT_PRIVATE_KEY_PEM is not set")
    _private_key = serialization.load_pem_private_key(pem.encode("utf-8"), password=None)
    return _private_key


def _load_public_key() -> RSAPublicKey:
    global _public_key
    if _public_key is not None:
        return _public_key
    pem = os.getenv("APGMS_RPT_PUBLIC_KEY_PEM")
    if not pem:
        raise RuntimeError("APGMS_RPT_PUBLIC_KEY_PEM is not set")
    _public_key = serialization.load_pem_public_key(pem.encode("utf-8"))
    return _public_key


def canonical_json(value: Dict[str, Any]) -> str:
    """Return canonical JSON (sorted keys, compact separators)."""

    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _b64url(data: bytes) -> str:
    return urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding_len = (4 - len(data) % 4) % 4
    return urlsafe_b64decode(data + "=" * padding_len)


def _protected_header(kid: Optional[str]) -> Dict[str, Any]:
    header: Dict[str, Any] = {"alg": "RS256", "typ": "JWT"}
    if kid:
        header["kid"] = kid
    return header


def sign(claims: Dict[str, Any], *, kid: Optional[str] = None) -> Tuple[str, str]:
    """Sign claims into a compact JWS and return the token + canonical payload."""

    header = _protected_header(kid)
    encoded_header = _b64url(canonical_json(header).encode("utf-8"))
    payload_c14n = canonical_json(claims)
    encoded_payload = _b64url(payload_c14n.encode("utf-8"))
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")

    key = _load_private_key()
    signature = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    token = f"{encoded_header}.{encoded_payload}.{_b64url(signature)}"
    return token, payload_c14n


def build(
    *,
    period_id: str,
    paygw_total: float,
    gst_total: float,
    source_digests: Dict[str, str],
    anomaly_score: float,
    rates_version: str,
    evidence_root: str,
    ttl_seconds: int = 3600,
    kid: Optional[str] = None,
    nonce: Optional[str] = None,
    iat: Optional[int] = None,
    exp: Optional[int] = None,
    jti: Optional[str] = None,
) -> Dict[str, Any]:
    """Build and sign an RPT JWS.

    Returns a dictionary containing the JWS token, decoded claims, and
    canonical payload string so callers can persist both artifacts.
    """

    issued_at = int(iat if iat is not None else time.time())
    expires_at = int(exp if exp is not None else issued_at + ttl_seconds)
    claims: Dict[str, Any] = {
        "type": "APGMS_RPT",
        "period_id": period_id,
        "paygw_total": round(paygw_total, 2),
        "gst_total": round(gst_total, 2),
        "source_digests": source_digests,
        "anomaly_score": anomaly_score,
        "rates_version": rates_version,
        "evidence_root": evidence_root,
        "nonce": nonce or uuid.uuid4().hex,
        "iat": issued_at,
        "exp": expires_at,
        "jti": jti or str(uuid.uuid4()),
    }
    token, payload_c14n = sign(claims, kid=kid)
    return {"token": token, "claims": claims, "payload_c14n": payload_c14n}


def decode(token: str) -> Dict[str, Any]:
    """Decode a compact JWS without verifying the signature."""

    parts = token.split(".")
    if len(parts) != 3:
        raise SignatureError("Token must have three parts")
    header_b64, payload_b64, signature_b64 = parts
    header = json.loads(_b64url_decode(header_b64).decode("utf-8"))
    payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    return {"header": header, "payload": payload, "signature_b64": signature_b64}


def verify(
    token: str,
    *,
    jti_store: Optional[Callable[[str, datetime], bool]] = None,
    now: Optional[int] = None,
) -> Dict[str, Any]:
    """Verify the token signature and return the payload claims.

    If ``jti_store`` is provided it will be invoked with ``(jti, exp_dt)``.
    The callable should return ``True`` if the JTI was recorded (first
    sighting) or ``False`` if the JTI has already been seen.  A replay raises
    :class:`ReplayError`.
    """

    parts = token.split(".")
    if len(parts) != 3:
        raise SignatureError("Token must have three parts")

    header_b64, payload_b64, signature_b64 = parts
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    signature = _b64url_decode(signature_b64)

    key = _load_public_key()
    try:
        key.verify(signature, signing_input, padding.PKCS1v15(), hashes.SHA256())
    except Exception as exc:  # pragma: no cover - cryptography gives rich errors
        raise SignatureError("Invalid signature") from exc

    payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))

    exp = payload.get("exp")
    if exp is None:
        raise SignatureError("Token missing exp claim")
    now_ts = int(now if now is not None else time.time())
    if now_ts >= int(exp):
        raise TokenExpiredError("Token expired")

    jti = payload.get("jti")
    if jti_store is not None:
        if not jti:
            raise SignatureError("Token missing jti claim")
        exp_dt = datetime.fromtimestamp(int(exp), tz=timezone.utc)
        if not jti_store(jti, exp_dt):
            raise ReplayError(f"JTI {jti} has already been used")

    return payload
