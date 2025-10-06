from __future__ import annotations

import hashlib
import json
import os
import psycopg2
import psycopg2.extras
from dataclasses import dataclass
from typing import Any, Dict, Optional

DEFAULT_TTL = int(os.getenv("PROTO_IDEMPOTENCY_TTL_SECS", "86400"))


def _dsn_from_env() -> str:
    if os.getenv("DATABASE_URL"):
        return os.getenv("DATABASE_URL")  # type: ignore[return-value]
    user = os.getenv("PGUSER", "postgres")
    password = os.getenv("PGPASSWORD", "postgres")
    host = os.getenv("PGHOST", "127.0.0.1")
    port = os.getenv("PGPORT", "5432")
    db = os.getenv("PGDATABASE", "postgres")
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


@dataclass
class CachedResponse:
    status_code: int
    body: Any
    headers: Dict[str, str]
    content_type: Optional[str]


class IdempotencyStore:
    def __init__(self, dsn: Optional[str] = None, default_ttl: int = DEFAULT_TTL) -> None:
        self._dsn = dsn or _dsn_from_env()
        self._default_ttl = default_ttl

    @property
    def default_ttl(self) -> int:
        return self._default_ttl

    def _connect(self):
        return psycopg2.connect(self._dsn)

    def _stable_payload(self, body: Any) -> str:
        return json.dumps(body, sort_keys=True, separators=(",", ":"))

    def ensure(self, key: str, *, ttl_secs: Optional[int] = None, allow_existing_pending: bool = False):
        ttl = ttl_secs or self._default_ttl
        conn = self._connect()
        try:
            with conn:
                with conn.cursor() as cur:
                    try:
                        cur.execute(
                            """
                            insert into idempotency_keys (id, first_seen_at, status, response_hash, failure_cause, ttl_secs)
                            values (%s, now(), 'pending', null, null, %s)
                            """,
                            (key, ttl),
                        )
                        return {"outcome": "acquired", "was_created": True, "ttl_secs": ttl}
                    except psycopg2.errors.UniqueViolation:
                        conn.rollback()

            with conn:
                with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                    cur.execute(
                        "select status, response_hash, failure_cause from idempotency_keys where id=%s",
                        (key,),
                    )
                    row = cur.fetchone()
                    if not row:
                        return {"outcome": "acquired", "was_created": True, "ttl_secs": ttl}
                    status = row["status"]
                    response_hash = row["response_hash"]
                    failure_cause = row["failure_cause"]
                    if status == "applied" and response_hash:
                        cached = self._load_cached(response_hash, conn)
                        if cached:
                            return {"outcome": "replay", "cached": cached}
                    if status == "failed":
                        return {"outcome": "failed", "failure_cause": failure_cause or "Idempotency key failed"}
                    if allow_existing_pending:
                        return {"outcome": "acquired", "was_created": False, "ttl_secs": ttl}
                    return {"outcome": "in_progress"}
        finally:
            conn.close()

    def mark_applied(self, key: str, *, status_code: int, body: Any, headers: Optional[Dict[str, str]] = None, content_type: Optional[str] = None, ttl_secs: Optional[int] = None) -> None:
        ttl = ttl_secs or self._default_ttl
        payload = self._stable_payload(body)
        hash_hex = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        hdrs = {k.lower(): str(v) for k, v in (headers or {}).items() if v is not None}
        if content_type and "content-type" not in hdrs:
            hdrs["content-type"] = content_type
        conn = self._connect()
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        insert into idempotency_responses(hash, status_code, body, content_type, headers, created_at)
                        values (%s,%s,%s,%s,%s,now())
                        on conflict (hash) do update set
                          status_code=excluded.status_code,
                          body=excluded.body,
                          content_type=excluded.content_type,
                          headers=excluded.headers,
                          created_at=now()
                        """,
                        (hash_hex, status_code, json.dumps(body, sort_keys=True, separators=(",", ":")), content_type or hdrs.get("content-type"), json.dumps(hdrs)),
                    )
                    cur.execute(
                        """
                        update idempotency_keys
                           set status='applied', response_hash=%s, failure_cause=null, ttl_secs=%s
                         where id=%s
                        """,
                        (hash_hex, ttl, key),
                    )
        finally:
            conn.close()

    def mark_failed(self, key: str, failure_cause: str) -> None:
        conn = self._connect()
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "update idempotency_keys set status='failed', failure_cause=%s where id=%s",
                        (failure_cause, key),
                    )
        finally:
            conn.close()

    def _load_cached(self, hash_hex: str, conn) -> Optional[CachedResponse]:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(
                "select status_code, body, content_type, headers from idempotency_responses where hash=%s",
                (hash_hex,),
            )
            row = cur.fetchone()
            if not row:
                return None
            headers = json.loads(row["headers"] or "{}")
            return CachedResponse(
                status_code=row["status_code"],
                body=json.loads(row["body"]) if isinstance(row["body"], str) else row["body"],
                headers={str(k): str(v) for k, v in headers.items()},
                content_type=row["content_type"],
            )
