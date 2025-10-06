from __future__ import annotations

import asyncio
import os
import uuid
import hashlib
from contextvars import ContextVar
from typing import Callable, Iterable, Optional, Tuple

import asyncpg
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

_idempotency_var: ContextVar[Optional[str]] = ContextVar("idempotency_key", default=None)
_httpx_patched = False


def get_current_idempotency_key() -> Optional[str]:
    return _idempotency_var.get()


def install_httpx_idempotency() -> None:
    global _httpx_patched
    if _httpx_patched:
        return
    try:
        import httpx
    except ModuleNotFoundError:  # pragma: no cover
        return

    original_async_request = httpx.AsyncClient.request
    original_sync_request = httpx.Client.request

    async def async_request(self, method, url, *args, **kwargs):  # type: ignore[override]
        key = get_current_idempotency_key()
        if key:
            headers = dict(kwargs.get("headers") or {})
            headers.setdefault("Idempotency-Key", key)
            kwargs["headers"] = headers
        return await original_async_request(self, method, url, *args, **kwargs)

    def sync_request(self, method, url, *args, **kwargs):  # type: ignore[override]
        key = get_current_idempotency_key()
        if key:
            headers = dict(kwargs.get("headers") or {})
            headers.setdefault("Idempotency-Key", key)
            kwargs["headers"] = headers
        return original_sync_request(self, method, url, *args, **kwargs)

    httpx.AsyncClient.request = async_request  # type: ignore[assignment]
    httpx.Client.request = sync_request  # type: ignore[assignment]
    _httpx_patched = True


class IdempotencyMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        ttl_seconds: int = 86400,
        dsn: Optional[str] = None,
        derive_key: Optional[Callable[[Request], Optional[str]]] = None,
        methods: Iterable[str] = ("POST", "PUT", "PATCH", "DELETE"),
    ) -> None:
        super().__init__(app)
        self.ttl_seconds = ttl_seconds
        self.dsn = dsn or os.getenv("DATABASE_URL") or "postgres://apgms:apgms_pw@127.0.0.1:5432/apgms"
        self.derive_key = derive_key
        self.methods = tuple(m.upper() for m in methods)
        self._pool: Optional[asyncpg.Pool] = None
        self._pool_lock = asyncio.Lock()
        app.add_event_handler("shutdown", self._close_pool)

    async def _close_pool(self) -> None:
        if self._pool:
            await self._pool.close()
            self._pool = None

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            async with self._pool_lock:
                if self._pool is None:
                    self._pool = await asyncpg.create_pool(dsn=self.dsn, min_size=1, max_size=10)
        return self._pool

    def _parse_ttl(self, header_value: Optional[str]) -> int:
        if not header_value:
            return self.ttl_seconds
        try:
            value = int(header_value)
            if value > 0:
                return value
        except (TypeError, ValueError):
            pass
        return self.ttl_seconds

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        method = (request.method or "").upper()
        key = request.headers.get("Idempotency-Key")
        if not key and self.derive_key:
            try:
                key = self.derive_key(request) or None
            except Exception:  # pragma: no cover - defensive
                key = None
        if not key:
            key = str(uuid.uuid4())

        if method not in self.methods:
            token = _idempotency_var.set(key)
            try:
                response = await call_next(request)
            finally:
                _idempotency_var.reset(token)
            response.headers["Idempotency-Key"] = key
            return response

        pool = await self._get_pool()
        conn = await pool.acquire()
        tx = conn.transaction()
        await tx.start()
        ttl = self._parse_ttl(request.headers.get("Idempotency-Ttl"))

        try:
            await conn.execute(
                """
                INSERT INTO idempotency_keys (id, status, ttl_secs)
                VALUES ($1, 'pending', $2)
                ON CONFLICT (id) DO NOTHING
                """,
                key,
                ttl,
            )
            record = await conn.fetchrow(
                """
                SELECT status, response_body, http_status, response_content_type, last_error
                  FROM idempotency_keys
                 WHERE id=$1
                 FOR UPDATE
                """,
                key,
            )
            if not record:
                raise RuntimeError("Idempotency record missing")

            if record["status"] == "applied":
                await tx.commit()
                body = bytes(record["response_body"]) if record["response_body"] else b""
                response = Response(
                    content=body,
                    status_code=record["http_status"] or 200,
                    media_type=record["response_content_type"],
                )
                response.headers["Idempotency-Key"] = key
                response.headers["Idempotency-Replayed"] = "true"
                return response

            if record["status"] == "failed":
                await tx.commit()
                response = JSONResponse(
                    status_code=409,
                    content={"error": "Idempotency replay rejected", "detail": record["last_error"]},
                )
                response.headers["Idempotency-Key"] = key
                response.headers["Idempotency-Replayed"] = "true"
                return response

            token = _idempotency_var.set(key)
            request.state.idempotency_key = key  # type: ignore[attr-defined]
            try:
                response = await call_next(request)
            except Exception as exc:
                await conn.execute(
                    """
                    UPDATE idempotency_keys
                       SET status='failed', http_status=500, last_error=$2, updated_at=now()
                     WHERE id=$1
                    """,
                    key,
                    str(exc)[:500],
                )
                await tx.commit()
                raise
            finally:
                _idempotency_var.reset(token)

            response, body = await self._capture_response(response)
            content_type = response.headers.get("content-type")
            if 200 <= response.status_code < 400:
                hash_hex = hashlib.sha256(body).hexdigest()
                await conn.execute(
                    """
                    UPDATE idempotency_keys
                       SET status='applied', response_hash=$2, response_body=$3, http_status=$4,
                           response_content_type=$5, updated_at=now(), applied_at=now()
                     WHERE id=$1
                    """,
                    key,
                    hash_hex,
                    body,
                    response.status_code,
                    content_type,
                )
            else:
                preview = body.decode("utf-8", errors="ignore")[:500]
                await conn.execute(
                    """
                    UPDATE idempotency_keys
                       SET status='failed', http_status=$2, last_error=$3, updated_at=now()
                     WHERE id=$1
                    """,
                    key,
                    response.status_code,
                    preview,
                )

            await tx.commit()
            response.headers["Idempotency-Key"] = key
            return response
        except Exception:
            await tx.rollback()
            raise
        finally:
            await pool.release(conn)

    async def _capture_response(self, response: Response) -> Tuple[Response, bytes]:
        if getattr(response, "body", None) is not None:
            body = response.body or b""
            if not isinstance(body, (bytes, bytearray)):
                body = bytes(body)
            new_response = Response(
                content=body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
                background=response.background,
            )
            return new_response, bytes(body)

        body_chunks = []
        body_iterator = getattr(response, "body_iterator", None)
        if body_iterator is not None:
            async for chunk in body_iterator:  # type: ignore
                body_chunks.append(chunk)
        body = b"".join(body_chunks)
        new_response = Response(
            content=body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
            background=response.background,
        )
        return new_response, body


__all__ = [
    "IdempotencyMiddleware",
    "install_httpx_idempotency",
    "get_current_idempotency_key",
]
