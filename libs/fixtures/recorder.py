"""Fixture recording middleware helpers for FastAPI services."""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Iterable, Mapping, MutableMapping

from fastapi import FastAPI, Request
from starlette.responses import Response


@dataclass
class RecorderConfig:
    port_label: str
    provider: str
    fixtures_root: Path
    session_id: str


def attach_fixture_recorder(app: FastAPI, *, port_label: str | None = None, provider: str | None = None) -> None:
    """Attach recording middleware to a FastAPI app."""
    cfg = _build_config(app, port_label=port_label, provider=provider)
    recorder = _FixtureRecorder(cfg)

    @app.middleware("http")
    async def _middleware(  # type: ignore[misc]
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        return await recorder(request, call_next)


class _FixtureRecorder:
    def __init__(self, config: RecorderConfig) -> None:
        self._cfg = config

    async def __call__(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        start = datetime.now(timezone.utc)
        body_bytes = await request.body()
        request._body = body_bytes  # cache for downstream handlers

        response = await call_next(request)

        payload = b""
        async for chunk in response.body_iterator:  # type: ignore[attr-defined]
            payload += chunk

        duration_ms = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)

        response_headers = _sanitize_headers(dict(response.headers))
        response_headers.pop("content-length", None)

        entry = {
            "id": str(uuid.uuid4()),
            "ts": start.isoformat(),
            "duration_ms": duration_ms,
            "port": self._cfg.port_label,
            "provider": self._cfg.provider,
            "request": {
                "method": request.method,
                "path": _compose_path(request),
                "headers": _sanitize_headers(dict(request.headers)),
                "body": _decode_body(body_bytes, request.headers.get("content-type")),
            },
            "response": {
                "status": response.status_code,
                "headers": response_headers,
                "body": _decode_body(payload, response.headers.get("content-type")),
            },
        }

        await _write_entry(self._cfg, entry)

        return Response(
            content=payload,
            status_code=response.status_code,
            headers=response_headers,
            media_type=response.media_type,
            background=response.background,
        )


async def _write_entry(cfg: RecorderConfig, entry: Mapping[str, Any]) -> None:
    day_dir = cfg.fixtures_root / cfg.port_label / datetime.now(timezone.utc).strftime("%Y%m%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    file_path = day_dir / f"{cfg.session_id}.jsonl"

    line = json.dumps(entry, default=_json_default) + "\n"
    await asyncio.to_thread(_append_line, file_path, line)


def _append_line(file_path: Path, line: str) -> None:
    with file_path.open("a", encoding="utf-8") as fh:
        fh.write(line)


def _json_default(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _build_config(app: FastAPI, *, port_label: str | None, provider: str | None) -> RecorderConfig:
    port = _slugify(port_label or getattr(app, "title", None) or os.getenv("PORT_LABEL") or "service")
    provider_name = (provider or os.getenv("FIXTURE_PROVIDER") or os.getenv("PORT_PROVIDER") or "primary").lower()

    fixtures_root = Path(os.getenv("FIXTURES_ROOT") or _discover_root() / "fixtures").resolve()
    session = os.getenv("FIXTURE_SESSION")
    if not session:
        ts = datetime.now(timezone.utc)
        session = f"{ts.strftime('%Y%m%d-%H%M%S')}-{os.getpid()}-{uuid.uuid4().hex[:8]}"

    return RecorderConfig(port_label=port, provider=provider_name, fixtures_root=fixtures_root, session_id=session)


def _discover_root() -> Path:
    current = Path.cwd().resolve()
    for candidate in [current, *current.parents]:
        if (candidate / ".git").exists():
            return candidate
    return current


def _compose_path(request: Request) -> str:
    path = request.url.path
    if request.url.query:
        path = f"{path}?{request.url.query}"
    return path


def _sanitize_headers(headers: MutableMapping[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in headers.items():
        if value is None:
            continue
        lower = key.lower()
        if lower in {"authorization", "proxy-authorization"}:
            result[key] = "***"
            continue
        if isinstance(value, str):
            result[key] = value
        elif isinstance(value, Iterable):
            result[key] = ",".join(str(v) for v in value)
        else:
            result[key] = str(value)
    result.pop("host", None)
    return result


def _decode_body(payload: bytes | str | None, content_type: str | None) -> Any:
    if payload in (None, b"", ""):
        return None
    if isinstance(payload, bytes):
        text = payload.decode("utf-8", errors="replace")
    else:
        text = str(payload)

    if content_type and "application/json" in content_type.lower():
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _slugify(value: str) -> str:
    lowered = value.lower()
    stripped = "-".join(filter(None, [segment for segment in lowered.replace("_", "-").split("-") if segment.strip("-")]))
    cleaned = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in stripped)
    cleaned = cleaned.strip("-")
    return cleaned or "port"


__all__ = ["attach_fixture_recorder"]
