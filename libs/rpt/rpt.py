# libs/rpt/rpt.py
"""RPT token signing backed by managed KMS infrastructure.

This module previously embedded a static secret in-process.  We now
support delegated signing via KMS (with an mTLS protected HTTP API) and
explicit key identifiers to enable rotation without downtime.

Environment variables:
    APGMS_RPT_ACTIVE_KID        Active signing key id (defaults to
                                "local-dev" for non-prod).
    APGMS_RPT_TRUSTED_KIDS      Comma-separated allow-list of legacy key ids
                                that should remain valid for verification
                                during rotation windows.
    APGMS_RPT_KMS_ENDPOINT      Base URL for the managed signing service.
    APGMS_RPT_KMS_CLIENT_CERT   Path to the client certificate used for mTLS.
    APGMS_RPT_KMS_CLIENT_KEY    Path to the client private key used for mTLS.
    APGMS_RPT_KMS_CA_CHAIN      Optional CA bundle path.  If omitted the
                                system trust store is used.
    APGMS_RPT_LOCAL_KEYS        Optional JSON mapping of {kid: secret}.  Used
                                for local/dev operation when KMS is not
                                available.  Values may be raw strings or
                                prefixed with base64:/hex: encodings.
    APGMS_RPT_SECRET            Legacy fallback secret (utf-8) used only when
                                neither KMS nor LOCAL_KEYS are configured.

KMS contract:
    POST {endpoint}/sign   => { signature: base64, keyId: str }
    POST {endpoint}/verify => { valid: bool }
The payload is canonical JSON bytes encoded as base64 in both requests.
"""
from __future__ import annotations

import base64
import binascii
import hmac
import hashlib
import json
import os
import ssl
import time
from functools import lru_cache
from typing import Any, Dict, Optional, Tuple

import httpx

_KEY_PREFIX_B64 = "base64:"
_KEY_PREFIX_HEX = "hex:"


class RptSignatureError(Exception):
    """Raised when a signature cannot be parsed or verified."""


class RptKmsUnavailable(Exception):
    """Raised when the configured KMS endpoint is unreachable."""


def _active_kid() -> str:
    return os.getenv("APGMS_RPT_ACTIVE_KID", "local-dev")


def _trusted_kids() -> set[str]:
    raw = os.getenv("APGMS_RPT_TRUSTED_KIDS")
    if not raw:
        return {_active_kid()}
    return {kid.strip() for kid in raw.split(",") if kid.strip()}


def _decode_secret(value: str) -> bytes:
    if value.startswith(_KEY_PREFIX_B64):
        return base64.b64decode(value[len(_KEY_PREFIX_B64) :])
    if value.startswith(_KEY_PREFIX_HEX):
        return bytes.fromhex(value[len(_KEY_PREFIX_HEX) :])
    try:
        # If it is valid base64 we treat it as such, otherwise raw utf-8.
        return base64.b64decode(value)
    except binascii.Error:
        return value.encode("utf-8")


@lru_cache(maxsize=1)
def _local_keyset() -> Dict[str, bytes]:
    raw = os.getenv("APGMS_RPT_LOCAL_KEYS")
    if raw:
        data = json.loads(raw)
        return {kid: _decode_secret(secret) for kid, secret in data.items()}

    legacy = os.getenv("APGMS_RPT_SECRET")
    if legacy:
        return {_active_kid(): legacy.encode("utf-8")}

    # Final fallback for tests/dev.
    return {_active_kid(): b"dev-secret-change-me"}


def _canonical(payload: Dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _tls_context(ca_path: Optional[str]) -> ssl.SSLContext:
    ctx = ssl.create_default_context(cafile=ca_path if ca_path else None)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_3
    return ctx


class _ManagedKmsClient:
    def __init__(self) -> None:
        endpoint = os.getenv("APGMS_RPT_KMS_ENDPOINT")
        if not endpoint:
            raise RptKmsUnavailable("APGMS_RPT_KMS_ENDPOINT not configured")
        cert = os.getenv("APGMS_RPT_KMS_CLIENT_CERT")
        key = os.getenv("APGMS_RPT_KMS_CLIENT_KEY")
        if not cert or not key:
            raise RptKmsUnavailable("Client certificate/key required for mTLS")
        ca = os.getenv("APGMS_RPT_KMS_CA_CHAIN")
        verify: ssl.SSLContext | str | bool
        if ca:
            verify = _tls_context(ca)
        else:
            verify = _tls_context(None)
        self._client = httpx.Client(
            base_url=endpoint.rstrip("/"),
            cert=(cert, key),
            verify=verify,
            timeout=httpx.Timeout(5.0, connect=2.0),
            headers={"User-Agent": "apgms-rpt/1.0"},
        )

    def sign(self, message: bytes, kid: str) -> Tuple[str, bytes]:
        payload = {
            "keyId": kid,
            "message": base64.b64encode(message).decode("ascii"),
            "algorithm": "HMAC_SHA256",
        }
        response = self._client.post("/sign", json=payload)
        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:  # pragma: no cover - surface original error
            raise RptKmsUnavailable(f"KMS signing failed: {exc}") from exc
        data = response.json()
        sig = data.get("signature")
        if not isinstance(sig, str):
            raise RptSignatureError("KMS response missing signature")
        key_id = data.get("keyId", kid)
        return key_id, base64.b64decode(sig)

    def verify(self, message: bytes, signature: bytes, kid: str) -> bool:
        payload = {
            "keyId": kid,
            "message": base64.b64encode(message).decode("ascii"),
            "signature": base64.b64encode(signature).decode("ascii"),
            "algorithm": "HMAC_SHA256",
        }
        response = self._client.post("/verify", json=payload)
        if response.status_code == 404:
            return False
        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:  # pragma: no cover
            raise RptKmsUnavailable(f"KMS verification failed: {exc}") from exc
        data = response.json()
        return bool(data.get("valid"))


@lru_cache(maxsize=1)
def _kms_client() -> Optional[_ManagedKmsClient]:
    endpoint = os.getenv("APGMS_RPT_KMS_ENDPOINT")
    if not endpoint:
        return None
    try:
        return _ManagedKmsClient()
    except RptKmsUnavailable:
        # If KMS is misconfigured we fall back to local signing to avoid
        # interrupting dev/test flows, but the caller should inspect logs.
        return None


def _encode_signature(kid: str, signature: bytes) -> str:
    encoded = base64.b64encode(signature).decode("ascii")
    return f"{kid}.{encoded}"


def _parse_signature(signature: str) -> Tuple[Optional[str], bytes]:
    if not signature:
        raise RptSignatureError("Empty signature")
    if "." in signature:
        kid, encoded = signature.split(".", 1)
        try:
            return kid, base64.b64decode(encoded)
        except binascii.Error as exc:
            raise RptSignatureError("Invalid base64 signature") from exc
    # Legacy support: hex digest or raw base64 without kid.
    try:
        return None, base64.b64decode(signature)
    except binascii.Error:
        try:
            return None, bytes.fromhex(signature)
        except ValueError as exc:
            raise RptSignatureError("Unrecognised signature encoding") from exc


def _hmac_digest(secret: bytes, message: bytes) -> bytes:
    return hmac.new(secret, message, hashlib.sha256).digest()


def sign(payload: Dict[str, Any]) -> str:
    message = _canonical(payload)
    kid = _active_kid()
    kms = _kms_client()
    if kms:
        key_id, signature = kms.sign(message, kid)
        return _encode_signature(key_id, signature)

    secret = _local_keyset().get(kid)
    if not secret:
        raise RptSignatureError(f"No local secret available for key id '{kid}'")
    signature = _hmac_digest(secret, message)
    return _encode_signature(kid, signature)


def verify(payload: Dict[str, Any], signature: str) -> bool:
    try:
        kid, raw_sig = _parse_signature(signature)
    except RptSignatureError:
        return False

    message = _canonical(payload)

    # If we know the kid and have KMS, prefer remote verification.
    kms = _kms_client()
    if kms and kid:
        try:
            return kms.verify(message, raw_sig, kid)
        except RptKmsUnavailable:
            # fall through to local verification below
            pass

    key_ids = list(_local_keyset().items())
    # Prioritise the explicitly requested kid followed by trusted rotation ids.
    candidates: list[Tuple[str, bytes]] = []
    if kid:
        secret = _local_keyset().get(kid)
        if secret:
            candidates.append((kid, secret))
    for known_kid in _trusted_kids():
        secret = _local_keyset().get(known_kid)
        if secret and (not kid or known_kid != kid):
            candidates.append((known_kid, secret))

    if not candidates:
        # As a last resort consider every key we have cached locally.
        candidates = list(key_ids)

    for _kid, secret in candidates:
        expected = _hmac_digest(secret, message)
        if hmac.compare_digest(expected, raw_sig):
            return True
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
    signature = sign(rpt)
    kid, _ = _parse_signature(signature)
    rpt["signature"] = signature
    if kid:
        rpt["signing_key_id"] = kid
    return rpt
