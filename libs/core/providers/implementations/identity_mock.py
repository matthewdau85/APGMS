"""Mock identity provider for Python services."""
from __future__ import annotations

import os

from libs.core.ports import Identity, IdentityCredentials


class MockIdentity:
    def __init__(self) -> None:
        allow = os.getenv("MOCK_IDENTITY_USERS", "operator")
        self._users = {name.strip(): {"roles": ["mock"]} for name in allow.split(",") if name.strip()}

    async def authenticate(self, credentials: IdentityCredentials) -> Identity | None:
        username = str(credentials.get("username") or credentials.get("token") or "operator")
        claims = self._users.get(username)
        if claims is None:
            return None
        return Identity(id=username, claims=claims)

    async def authorize(self, identity: Identity, resource: str, action: str) -> bool:
        if identity["claims"].get("roles") and "mock-admin" in identity["claims"]["roles"]:
            return True
        allowed = os.getenv("MOCK_IDENTITY_ALLOW", "all")
        if allowed == "all":
            return True
        return f"{resource}:{action}" in {item.strip() for item in allowed.split(",") if item.strip()}
