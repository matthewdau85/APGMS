"""Real identity provider wrapper using HTTP calls."""
from __future__ import annotations

import json
import os
import urllib.request

from libs.core.ports import Identity, IdentityCredentials


def _require_flag() -> None:
    flag = os.getenv("IDENTITY_REAL_ENABLED", "").lower()
    if flag not in {"1", "true", "yes"}:
        raise RuntimeError("Real identity provider disabled. Set IDENTITY_REAL_ENABLED=true to enable.")


def _base_url() -> str:
    base = os.getenv("IDENTITY_API_BASE")
    if not base:
        raise RuntimeError("IDENTITY_API_BASE must be configured for the real identity provider")
    return base


class RealIdentity:
    async def authenticate(self, credentials: IdentityCredentials) -> Identity | None:
        _require_flag()
        req = urllib.request.Request(
            f"{_base_url()}/authenticate",
            data=json.dumps(credentials).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:  # type: ignore[arg-type]
            data = json.loads(resp.read().decode() or "{}")
        if not data:
            return None
        return Identity(id=data.get("id", "unknown"), claims=data.get("claims", {}))

    async def authorize(self, identity: Identity, resource: str, action: str) -> bool:
        _require_flag()
        payload = {"identity": identity, "resource": resource, "action": action}
        req = urllib.request.Request(
            f"{_base_url()}/authorize",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:  # type: ignore[arg-type]
            data = json.loads(resp.read().decode() or "{}")
        return bool(data.get("allowed"))
