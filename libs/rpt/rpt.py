# libs/rpt/rpt.py
import json, hmac, hashlib, os, time
from typing import Dict, Any

def _key() -> bytes:
    k = os.getenv("APGMS_RPT_SECRET", "dev-secret-change-me")
    return k.encode("utf-8")

def sign(payload: Dict[str, Any]) -> str:
    msg = json.dumps(payload, sort_keys=True, separators=(",",":")).encode("utf-8")
    return hmac.new(_key(), msg, hashlib.sha256).hexdigest()

def verify(payload: Dict[str, Any], signature: str) -> bool:
    try:
        exp = sign(payload)
        return hmac.compare_digest(exp, signature)
    except Exception:
        return False

def _normalize_rates_evidence(evidence: Dict[str, Dict[str, str]]) -> Dict[str, Dict[str, str]]:
    normalized = {}
    for port, details in sorted(evidence.items()):
        if not isinstance(details, dict):
            raise TypeError("rates evidence entries must be dicts")
        if "id" not in details or "checksum" not in details:
            raise ValueError("rates evidence entries require 'id' and 'checksum'")
        normalized[port] = {
            "port": details.get("port", port),
            "id": details["id"],
            "checksum": details["checksum"],
        }
    if not normalized:
        raise ValueError("rates evidence cannot be empty")
    return normalized


def build(
    period_id: str,
    paygw_total: float,
    gst_total: float,
    source_digests: Dict[str, str],
    anomaly_score: float,
    rates_evidence: Dict[str, Dict[str, str]],
    ttl_seconds: int = 3600,
) -> Dict[str, Any]:
    rpt = {
        "period_id": period_id,
        "paygw_total": round(paygw_total, 2),
        "gst_total": round(gst_total, 2),
        "source_digests": source_digests,
        "anomaly_score": anomaly_score,
        "rates_evidence": _normalize_rates_evidence(rates_evidence),
        "expires_at": int(time.time()) + ttl_seconds,
        "nonce": os.urandom(8).hex(),
    }
    rpt["signature"] = sign(rpt)
    return rpt
