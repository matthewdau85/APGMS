from __future__ import annotations
from typing import Optional, Dict
import base64, time, os
import nacl.signing
import cbor2

RPT_TAG = b"APGMS_RPT_v1"

def _now(): return int(time.time())

def issue_rpt(payload: dict, sk_bytes: bytes) -> str:
    signer = nacl.signing.SigningKey(sk_bytes)
    ordered_keys = [
        "entity_id","period_id","tax_type","amount_cents","merkle_root","running_balance_hash",
        "anomaly_vector","thresholds","rail_id","destination_id","expiry_ts","reference","nonce"
    ]
    ordered = [(k, payload[k]) for k in ordered_keys]
    msg = RPT_TAG + cbor2.dumps(ordered)
    sig = signer.sign(msg).signature
    tok = base64.urlsafe_b64encode(cbor2.dumps({
        "t": "rpt","v": 1, "p": cbor2.dumps(ordered),
        "s": bytes(signer.verify_key), "sig": sig
    })).decode("ascii").rstrip("=")
    return tok

def decode(token: str) -> dict:
    raw = base64.urlsafe_b64decode(token + "==")
    return cbor2.loads(raw)

def verify_rpt(token: str, jti_registry: Optional[set] = None) -> bool:
    obj = decode(token)
    if obj.get("t") != "rpt" or obj.get("v") != 1: return False
    p_bytes: bytes = obj["p"]; vk_bytes: bytes = obj["s"]; sig: bytes = obj["sig"]
    vk = nacl.signing.VerifyKey(vk_bytes)
    try:
        vk.verify(RPT_TAG + p_bytes, sig)
    except Exception:
        return False
    payload_list = cbor2.loads(p_bytes)
    d = {k: v for k, v in payload_list}
    if int(d["expiry_ts"]) < _now() - 30: return False
    if jti_registry is not None:
        jti = d["nonce"]
        if jti in jti_registry: return False
        jti_registry.add(jti)
    return True

def introspect(token: str) -> dict:
    o = decode(token)
    d = {k: v for k, v in cbor2.loads(o["p"])}
    d["verify_key_b64"] = base64.b64encode(o["s"]).decode("ascii")
    return d
