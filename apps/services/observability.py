"""Shared observability helpers for APGMS Python services."""
from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Protocol

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

try:  # FastAPI optional import guard
    from fastapi import FastAPI, Response
    from starlette.requests import Request
except Exception:  # pragma: no cover - FastAPI not available in some contexts
    FastAPI = None  # type: ignore
    Response = None  # type: ignore
    Request = Any  # type: ignore


_HTTP_BUCKETS = (
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1,
    2.5,
    5,
    10,
)


HTTP_REQUESTS = Counter(
    "apgms_http_requests_total",
    "Total HTTP requests processed",
    ["service", "version", "env", "method", "route", "status"],
)
HTTP_LATENCY = Histogram(
    "apgms_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["service", "version", "env", "method", "route"],
    buckets=_HTTP_BUCKETS,
)
HTTP_IN_FLIGHT = Gauge(
    "apgms_http_requests_in_flight",
    "In-flight HTTP requests",
    ["service", "version", "env"],
)
SERVICE_METADATA = Gauge(
    "apgms_service_metadata",
    "Static service metadata",
    ["service", "version", "env"],
)
DB_CONNECTIONS = Gauge(
    "apgms_db_connections_active",
    "Active database connections",
    ["service", "version", "env"],
)
DLQ_DEPTH = Gauge(
    "apgms_dlq_messages",
    "Messages currently buffered in a dead-letter queue",
    ["service", "version", "env", "queue"],
)
RELEASE_FAILURES = Counter(
    "apgms_release_failures_total",
    "Release pipeline failures recorded by services",
    ["service", "version", "env", "stage"],
)


class SupportsClose(Protocol):
    def close(self) -> Any:
        ...


@dataclass
class InstrumentedConnection:
    _conn: SupportsClose
    _labels: Dict[str, str]
    _closed: bool = False

    def __post_init__(self) -> None:
        DB_CONNECTIONS.labels(**self._labels).inc()

    def __getattr__(self, item: str) -> Any:
        return getattr(self._conn, item)

    def close(self) -> Any:  # pragma: no cover - psycopg2 close returns None
        if not self._closed:
            DB_CONNECTIONS.labels(**self._labels).dec()
            self._closed = True
        return self._conn.close()

    def __enter__(self) -> "InstrumentedConnection":
        return self

    def __exit__(self, exc_type, exc, tb) -> Optional[bool]:
        self.close()
        return None


class Observability:
    """Helper to provide consistent metrics and tracing labels."""

    def __init__(self, service_name: str, *, version: str | None = None, env: str | None = None) -> None:
        self.service = service_name or os.getenv("SERVICE_NAME", "unknown-service")
        self.version = (
            version
            or os.getenv("SERVICE_VERSION")
            or os.getenv("VERSION")
            or os.getenv("APP_VERSION")
            or "dev"
        )
        self.env = env or os.getenv("SERVICE_ENV") or os.getenv("ENVIRONMENT") or "local"
        self._service_labels = {"service": self.service, "version": self.version, "env": self.env}
        SERVICE_METADATA.labels(**self._service_labels).set(1)

    @property
    def service_labels(self) -> Dict[str, str]:
        return dict(self._service_labels)

    def instrument_db_connection(self, conn: SupportsClose) -> InstrumentedConnection:
        return InstrumentedConnection(conn, self._service_labels)

    def set_dlq_depth(self, queue: str, depth: int) -> None:
        DLQ_DEPTH.labels(queue=queue, **self._service_labels).set(depth)

    def record_release_failure(self, stage: str) -> None:
        RELEASE_FAILURES.labels(stage=stage, **self._service_labels).inc()

    def install_metrics_endpoint(self, app: Any) -> None:
        if Response is None:
            return
        for route in getattr(app, "router", getattr(app, "routes", [])):  # pragma: no branch
            if getattr(route, "path", None) == "/metrics":
                return

        @app.get("/metrics")
        def _metrics() -> Response:
            payload = generate_latest()
            return Response(payload, media_type=CONTENT_TYPE_LATEST)

    def install_http_middleware(self, app: Any) -> None:
        if Request is None or FastAPI is None:
            return
        flag = "_apgms_http_metrics"
        if getattr(app.state, flag, False):
            return
        app.state.__setattr__(flag, True)

        @app.middleware("http")
        async def _metrics_middleware(request: Request, call_next):  # type: ignore[override]
            route_obj = request.scope.get("route")
            route_path = getattr(route_obj, "path", request.scope.get("path", request.url.path))
            method = request.method.upper()
            start = time.perf_counter()
            status_code = 500
            HTTP_IN_FLIGHT.labels(**self._service_labels).inc()
            try:
                response = await call_next(request)
                status_code = response.status_code
                return response
            finally:
                elapsed = time.perf_counter() - start
                HTTP_LATENCY.labels(route=route_path, method=method, **self._service_labels).observe(elapsed)
                HTTP_REQUESTS.labels(
                    route=route_path,
                    method=method,
                    status=str(status_code),
                    **self._service_labels,
                ).inc()
                HTTP_IN_FLIGHT.labels(**self._service_labels).dec()


def ensure_path_for_observability(current_file: str) -> None:
    """Append the shared services directory (where this module lives) to sys.path."""
    current = os.path.abspath(current_file)
    for _ in range(6):
        parent = os.path.dirname(current)
        if os.path.exists(os.path.join(parent, "observability.py")):
            if parent not in sys.path:
                sys.path.append(parent)
            return
        current = parent
