from __future__ import annotations

import base64
import hashlib
import json
import os
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException
from nacl.encoding import RawEncoder
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey
from pydantic import BaseModel
from psycopg import errors
from psycopg_pool import ConnectionPool

app = FastAPI(title="rpt-verify")


class VerifyIn(BaseModel):
    payload_c14n: str
    signature_b64: str
    kid: Optional[str] = None


def build_conninfo() -> str:
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    host = os.getenv("PGHOST", "127.0.0.1")
    port = os.getenv("PGPORT", "5432")
    db = os.getenv("PGDATABASE", "apgms")
    user = os.getenv("PGUSER", "postgres")
    password = os.getenv("PGPASSWORD")
    parts = [f"host={host}", f"port={port}", f"dbname={db}", f"user={user}"]
    if password:
        parts.append(f"password={password}")
    return " ".join(parts)


pool = ConnectionPool(build_conninfo(), min_size=1, max_size=5, kwargs={"autocommit": True})


@lru_cache(maxsize=1)
def env_keyring() -> Dict[str, str]:
    raw = os.getenv("RPT_TRUSTED_KEYS_JSON")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items()}
    except json.JSONDecodeError:
        pass
    return {}


def decode_b64(value: str) -> bytes:
    cleaned = value.strip()
    try:
        return base64.b64decode(cleaned, validate=True)
    except Exception:
        padding = "=" * ((4 - len(cleaned) % 4) % 4)
        return base64.urlsafe_b64decode(cleaned + padding)


def fetch_trusted_key(kid: str) -> bytes:
    query = (
        "SELECT public_key_b64 FROM rpt_trusted_keys "
        "WHERE kid = %s AND (revoked_at IS NULL OR revoked_at > NOW()) "
        "ORDER BY created_at DESC LIMIT 1"
    )
    with pool.connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(query, (kid,))
                row = cur.fetchone()
            except errors.UndefinedTable:
                row = None
    if row and row[0]:
        return decode_b64(row[0])
    mapping = env_keyring()
    if kid in mapping:
        return decode_b64(mapping[kid])
    raise HTTPException(status_code=404, detail=f"Unknown key id: {kid}")


def fetch_token(abn: str, tax_type: str, period_id: str, nonce: str) -> Dict[str, Any]:
    sql = (
        "SELECT kid, payload_sha256, signature, status, expires_at, nonce "
        "FROM rpt_tokens WHERE abn=%s AND tax_type=%s AND period_id=%s AND nonce=%s "
        "ORDER BY created_at DESC LIMIT 1"
    )
    with pool.connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(sql, (abn, tax_type, period_id, nonce))
            except errors.UndefinedColumn:
                fallback_sql = (
                    "SELECT key_id AS kid, payload_sha256, signature, status, expires_at, nonce "
                    "FROM rpt_tokens WHERE abn=%s AND tax_type=%s AND period_id=%s AND nonce=%s "
                    "ORDER BY created_at DESC LIMIT 1"
                )
                cur.execute(fallback_sql, (abn, tax_type, period_id, nonce))
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No RPT found for period/nonce")
    return {
        "kid": row[0],
        "payload_sha256": row[1],
        "signature": row[2],
        "status": row[3],
        "expires_at": row[4],
        "nonce": row[5],
    }


def parse_payload(payload_c14n: str) -> Dict[str, Any]:
    try:
        return json.loads(payload_c14n)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid canonical payload JSON: {exc}")


@app.get("/trusted-keys/{kid}")
def get_trusted_key(kid: str):
    key = fetch_trusted_key(kid)
    return {"kid": kid, "public_key_b64": base64.b64encode(key).decode("ascii")}


@app.post("/verify")
def verify(in_payload: VerifyIn):
    payload_json = parse_payload(in_payload.payload_c14n)
    kid = in_payload.kid or payload_json.get("kid") or payload_json.get("key_id")
    if not kid:
        raise HTTPException(status_code=400, detail="Payload missing kid")

    abn = payload_json.get("abn") or payload_json.get("entity_id")
    tax_type = payload_json.get("tax_type") or payload_json.get("taxType")
    period_id = payload_json.get("period_id") or payload_json.get("periodId")
    nonce = payload_json.get("nonce")

    if not all([abn, tax_type, period_id, nonce]):
        raise HTTPException(status_code=400, detail="Payload missing abn/tax_type/period_id/nonce")

    record = fetch_token(str(abn), str(tax_type), str(period_id), str(nonce))

    stored_kid = record.get("kid")
    if stored_kid and stored_kid != kid:
        raise HTTPException(status_code=409, detail="Key id mismatch for period")

    payload_bytes = in_payload.payload_c14n.encode("utf-8")
    payload_hash = hashlib.sha256(payload_bytes).hexdigest()
    stored_hash = record.get("payload_sha256")
    if stored_hash and str(stored_hash) != payload_hash:
        raise HTTPException(status_code=409, detail="Payload hash mismatch")

    expires_at = record.get("expires_at")
    if expires_at:
        if isinstance(expires_at, str):
            normalized = expires_at.replace("Z", "+00:00")
            expires_dt = datetime.fromisoformat(normalized)
        else:
            expires_dt = expires_at
        if expires_dt.tzinfo is None:
            expires_dt = expires_dt.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires_dt:
            raise HTTPException(status_code=400, detail="RPT expired")

    trusted_key = fetch_trusted_key(kid)
    verify_key = VerifyKey(trusted_key, encoder=RawEncoder)

    try:
        signature = decode_b64(in_payload.signature_b64)
        verify_key.verify(payload_bytes, signature)
    except (BadSignatureError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid signature: {exc}")

    status = record.get("status")
    if status and str(status).upper() not in {"ISSUED", "ACTIVE"}:
        raise HTTPException(status_code=403, detail=f"Token status not valid: {status}")

    return {
        "ok": True,
        "kid": kid,
        "payload_sha256": payload_hash,
        "status": status,
        "expires_at": expires_at.isoformat() if hasattr(expires_at, "isoformat") else expires_at,
    }
