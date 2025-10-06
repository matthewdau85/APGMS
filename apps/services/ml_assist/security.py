"""Security helpers for the ML assist service."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from functools import lru_cache
from typing import Any, Dict, Iterable, Set

from cryptography.fernet import Fernet


class SecurityConfigError(RuntimeError):
    """Raised when required security configuration is missing."""


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


@lru_cache(maxsize=1)
def get_hash_salt() -> bytes:
    """Return the configured salt for hashing personal identifiers."""
    salt = os.getenv("ML_PII_HASH_SALT") or os.getenv("PII_HASH_SALT")
    if not salt:
        raise SecurityConfigError("Set ML_PII_HASH_SALT (or PII_HASH_SALT) for hashing identifiers")
    return salt.encode("utf-8")


def hash_identifier(value: str) -> str:
    """Hash a personal identifier with the configured salt."""
    data = value.strip()
    if not data:
        raise ValueError("Identifier must be non-empty")
    digest = hashlib.sha256()
    digest.update(get_hash_salt())
    digest.update(data.encode("utf-8"))
    return digest.hexdigest()


@lru_cache(maxsize=1)
def get_cipher() -> Fernet:
    """Return a Fernet cipher derived from the app secrets KMS key."""
    key_material = os.getenv("APP_SECRETS_KMS_KEY")
    if not key_material:
        raise SecurityConfigError("Set APP_SECRETS_KMS_KEY to encrypt ML artifacts")
    digest = hashlib.sha256(key_material.encode("utf-8")).digest()
    encoded = base64.urlsafe_b64encode(digest)
    return Fernet(encoded)


@lru_cache(maxsize=1)
def get_jwt_secret() -> bytes:
    secret = os.getenv("APP_JWT_SECRET")
    if not secret:
        raise SecurityConfigError("Set APP_JWT_SECRET to validate access tokens")
    return secret.encode("utf-8")


def decode_token(token: str) -> Dict[str, Any]:
    """Decode a compact JWT supporting HS256 without external dependencies."""
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except ValueError as exc:  # pragma: no cover - defensive
        raise SecurityConfigError("Invalid access token format") from exc

    try:
        header = json.loads(_b64url_decode(header_b64))
        payload = json.loads(_b64url_decode(payload_b64))
    except (json.JSONDecodeError, ValueError) as exc:  # pragma: no cover - defensive
        raise SecurityConfigError("Invalid access token payload") from exc

    if header.get("alg") != "HS256":
        raise SecurityConfigError("Invalid access token algorithm")

    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    expected = hmac.new(get_jwt_secret(), signing_input, hashlib.sha256).digest()
    try:
        provided = _b64url_decode(signature_b64)
    except ValueError as exc:  # pragma: no cover - defensive
        raise SecurityConfigError("Invalid access token signature") from exc

    if not hmac.compare_digest(expected, provided):
        raise SecurityConfigError("Invalid access token signature")

    return payload


def scopes_from_claims(claims: Dict[str, Any]) -> Set[str]:
    """Extract a normalized set of scopes from JWT claims."""
    scope_claim = claims.get("scope")
    if isinstance(scope_claim, str):
        return {s for s in scope_claim.split() if s}
    if isinstance(scope_claim, Iterable):
        return {str(s) for s in scope_claim if s}
    return set()


def ensure_scopes(claims: Dict[str, Any], required: Iterable[str]) -> None:
    """Validate that all required scopes are present on the claims."""
    provided = scopes_from_claims(claims)
    missing = [scope for scope in required if scope not in provided]
    if missing:
        raise SecurityConfigError(f"Missing scopes: {', '.join(missing)}")
