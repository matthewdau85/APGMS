"""Mock KMS provider using HMAC for signatures."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from typing import Any

from libs.core.ports import JwksResult


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


class MockKms:
    def __init__(self) -> None:
        seed = os.getenv("MOCK_KMS_SEED", "mock-secret-key").encode()
        self._secret = seed
        self._kid = os.getenv("MOCK_KMS_KID", "mock-kms")

    async def signJWS(self, payload: Any) -> str:
        body = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode()
        header = _b64url(json.dumps({"alg": "HS256", "kid": self._kid}).encode())
        payload_b64 = _b64url(body)
        signing_input = f"{header}.{payload_b64}".encode()
        signature = hmac.new(self._secret, signing_input, hashlib.sha256).digest()
        return f"{header}.{payload_b64}.{_b64url(signature)}"

    async def rotate(self) -> None:
        self._secret = os.urandom(32)

    async def jwks(self) -> JwksResult:
        return {"keys": [{"kty": "oct", "kid": self._kid}]}

    async def verify(self, payload: bytes | str, signature: bytes | str) -> bool:
        payload_bytes = payload if isinstance(payload, bytes) else str(payload).encode()
        signature_bytes = signature if isinstance(signature, bytes) else base64.b64decode(str(signature))
        digest = hmac.new(self._secret, payload_bytes, hashlib.sha256).digest()
        return hmac.compare_digest(digest, signature_bytes)
