"""Real KMS provider wrapper for boto3 (if available)."""
from __future__ import annotations

import base64
import json
import os
from typing import Any

from libs.core.ports import JwksResult

try:
    import boto3  # type: ignore
except ImportError:  # pragma: no cover
    boto3 = None  # type: ignore


def _require_flag() -> None:
    flag = os.getenv("KMS_REAL_ENABLED", "").lower()
    if flag not in {"1", "true", "yes"}:
        raise RuntimeError("Real KMS provider disabled. Set KMS_REAL_ENABLED=true to enable.")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


class RealKms:
    def __init__(self) -> None:
        if boto3 is None:
            raise RuntimeError("boto3 is required for the real KMS provider")
        self._key_id = os.getenv("KMS_KEY_ID")
        if not self._key_id:
            raise RuntimeError("KMS_KEY_ID must be set to use the real KMS provider")
        self._client = boto3.client("kms")
        self._public_key_cache: bytes | None = None

    async def signJWS(self, payload: Any) -> str:
        _require_flag()
        message = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode()
        header = _b64url(json.dumps({"alg": "EdDSA", "kid": self._key_id}).encode())
        payload_b64 = _b64url(message)
        signing_input = f"{header}.{payload_b64}".encode()
        response = self._client.sign(
            KeyId=self._key_id,
            Message=signing_input,
            MessageType="RAW",
            SigningAlgorithm="EDDSA",
        )
        signature = response["Signature"]
        return f"{header}.{payload_b64}.{_b64url(signature)}"

    async def rotate(self) -> None:
        _require_flag()
        self._public_key_cache = None

    async def jwks(self) -> JwksResult:
        _require_flag()
        if self._public_key_cache is None:
            response = self._client.get_public_key(KeyId=self._key_id)
            self._public_key_cache = response["PublicKey"]
        x = _b64url(self._public_key_cache[-32:])  # raw Ed25519 key
        return {"keys": [{"kty": "OKP", "crv": "Ed25519", "kid": self._key_id, "x": x, "use": "sig"}]}

    async def verify(self, payload: bytes | str, signature: bytes | str) -> bool:
        _require_flag()
        payload_bytes = payload if isinstance(payload, bytes) else str(payload).encode()
        signature_bytes = signature if isinstance(signature, bytes) else base64.b64decode(str(signature))
        response = self._client.verify(
            KeyId=self._key_id,
            Message=payload_bytes,
            MessageType="RAW",
            Signature=signature_bytes,
            SigningAlgorithm="EDDSA",
        )
        return bool(response.get("SignatureValid"))
