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

def build(period_id: str,
          paygw_total: float,
          gst_total: float,
          source_digests: Dict[str,str],
          anomaly_score: float,
          ttl_seconds: int = 3600) -> Dict[str, Any]:
    rpt = {
        "period_id": period_id,
        "paygw_total": round(paygw_total,2),
        "gst_total": round(gst_total,2),
        "source_digests": source_digests,
        "anomaly_score": anomaly_score,
        "expires_at": int(time.time()) + ttl_seconds,
        "nonce": os.urandom(8).hex()
    }
    rpt["signature"] = sign(rpt)
    return rpt
