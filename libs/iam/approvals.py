"""IAM client helpers for enforcing MFA + separation of duties."""
from __future__ import annotations

import os
import ssl
from functools import lru_cache
from typing import Any, Dict, Optional

import httpx


class DualControlError(Exception):
    """Raised when dual-approval enforcement fails."""


class MfaRequiredError(DualControlError):
    """Raised when the IAM service indicates MFA is missing."""


class ApprovalDeniedError(DualControlError):
    """Raised when the IAM service denies the requested action."""


@lru_cache(maxsize=1)
def _iam_client() -> Optional[httpx.Client]:
    if os.getenv("APGMS_IAM_BYPASS", "").lower() in {"1", "true"}:
        return None

    base_url = os.getenv("APGMS_IAM_URL") or os.getenv("IAM_BASE_URL")
    if not base_url:
        raise DualControlError("APGMS_IAM_URL must be configured")

    cert = os.getenv("APGMS_IAM_CLIENT_CERT") or os.getenv("IAM_MTLS_CERT")
    key = os.getenv("APGMS_IAM_CLIENT_KEY") or os.getenv("IAM_MTLS_KEY")
    if not cert or not key:
        raise DualControlError("IAM mTLS client cert/key are required")

    ca = os.getenv("APGMS_IAM_CA_CHAIN") or os.getenv("IAM_MTLS_CA")
    context = ssl.create_default_context(cafile=ca if ca else None)
    context.minimum_version = ssl.TLSVersion.TLSv1_3

    return httpx.Client(
        base_url=base_url.rstrip("/"),
        verify=context,
        cert=(cert, key),
        timeout=httpx.Timeout(5.0, connect=2.0),
        headers={"User-Agent": "apgms-iam/1.0"},
    )


def ensure_dual_control(
    token: Optional[str],
    action: str,
    subject: Optional[str],
    resource: Dict[str, Any],
) -> Dict[str, Any]:
    """Validate MFA + dual control via the IAM approvals API."""
    client = _iam_client()
    if client is None:
        # bypass for dev/test
        return {"bypass": True}

    if not token:
        raise MfaRequiredError("Authorization token is required")

    payload = {
        "action": action,
        "subject": subject,
        "resource": resource,
        "enforce": {"mfa": True, "dualControl": True},
    }

    response = client.post("/approvals/verify", json=payload, headers={"Authorization": token})
    if response.status_code == 401:
        raise MfaRequiredError("IAM rejected the caller's token")
    if response.status_code == 403:
        raise ApprovalDeniedError("IAM denied the requested action")
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:  # pragma: no cover - propagate
        raise DualControlError(f"IAM approvals request failed: {exc}") from exc

    data = response.json()
    if not data.get("mfa"):
        raise MfaRequiredError("IAM MFA requirement not met")
    if not data.get("dualApproval"):
        raise ApprovalDeniedError("IAM dual-control requirement not met")
    return data
