"""Shared FastAPI observability plumbing."""

from __future__ import annotations

import hashlib
import os
import time
import uuid
from typing import Any, Dict

from fastapi import FastAPI, Request, Response
from opentelemetry import context, trace
from opentelemetry.baggage import set_baggage
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import SpanKind, Status, StatusCode
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

__all__ = ["instrument_app"]

_HTTP_COUNTERS: Dict[str, Counter] = {}
_HTTP_HISTOGRAMS: Dict[str, Histogram] = {}
_TRACER_CONFIGURED = False


def _get_metric_name(prefix: str, service: str) -> str:
    digest = hashlib.sha1(service.encode("utf-8")).hexdigest()[:6]
    return f"apgms_{prefix}_{digest}"


def _get_counter(service: str) -> Counter:
    if service not in _HTTP_COUNTERS:
        name = _get_metric_name("http_requests_total", service)
        _HTTP_COUNTERS[service] = Counter(
            name,
            "Total HTTP requests",
            labelnames=("method", "route", "status"),
        )
    return _HTTP_COUNTERS[service]


def _get_histogram(service: str) -> Histogram:
    if service not in _HTTP_HISTOGRAMS:
        name = _get_metric_name("http_request_duration_seconds", service)
        _HTTP_HISTOGRAMS[service] = Histogram(
            name,
            "HTTP request duration",
            labelnames=("method", "route"),
        )
    return _HTTP_HISTOGRAMS[service]


def _configure_tracing(service_name: str) -> None:
    global _TRACER_CONFIGURED
    if _TRACER_CONFIGURED:
        return
    resource = Resource.create(
        {
            "service.name": service_name,
            "service.namespace": "apgms",
            "service.instance.id": os.getenv("HOSTNAME", uuid.uuid4().hex),
        }
    )
    provider = TracerProvider(resource=resource)
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    headers_env = os.getenv("OTEL_EXPORTER_OTLP_HEADERS", "")
    headers: Dict[str, str] = {}
    if headers_env:
        for pair in headers_env.split(","):
            if not pair.strip():
                continue
            if "=" not in pair:
                continue
            key, value = pair.split("=", 1)
            headers[key.strip()] = value.strip()
    exporter = OTLPSpanExporter(endpoint=endpoint, headers=headers or None)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    _TRACER_CONFIGURED = True


def _ensure_route(app: FastAPI, path: str, method: str, handler) -> None:
    existing = [r for r in app.router.routes if getattr(r, "path", None) == path and method.upper() in getattr(r, "methods", set())]
    if existing:
        return
    app.add_api_route(path, handler, methods=[method])


def instrument_app(app: FastAPI, service_name: str) -> None:
    """Wire up OTLP tracing, Prometheus metrics, and X-Request-ID propagation."""

    if getattr(app.state, "_apgms_observability", False):
        return

    _configure_tracing(service_name)
    tracer = trace.get_tracer(service_name)
    counter = _get_counter(service_name)
    histogram = _get_histogram(service_name)

    @app.middleware("http")
    async def _observability_middleware(request: Request, call_next):  # type: ignore[override]
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        baggage_ctx = set_baggage("x-request-id", request_id)
        token = context.attach(baggage_ctx)
        start = time.perf_counter()
        span_name = f"HTTP {request.method}"
        route_template = None
        try:
            with tracer.start_as_current_span(
                span_name,
                kind=SpanKind.SERVER,
                attributes={
                    "http.request_id": request_id,
                    "http.method": request.method,
                    "http.target": request.url.path,
                    "net.peer.ip": request.client.host if request.client else None,
                },
            ) as span:
                response = await call_next(request)
                if request.scope.get("route") is not None:
                    route_template = getattr(request.scope["route"], "path", request.url.path)
                else:
                    route_template = request.url.path
                if span.is_recording():
                    span.set_attribute("http.route", route_template)
                    span.set_attribute("http.status_code", response.status_code)
                response.headers["x-request-id"] = request_id
        except Exception as exc:  # pragma: no cover - defensive
            active_span = trace.get_current_span()
            if active_span.is_recording():
                active_span.record_exception(exc)
                active_span.set_status(Status(StatusCode.ERROR, str(exc)))
            response = Response(status_code=500)
            response.headers["x-request-id"] = request_id
            route_template = request.url.path
            raise
        finally:
            duration = time.perf_counter() - start
            context.detach(token)
            route_label = route_template or request.url.path
            counter.labels(request.method, route_label, str(response.status_code)).inc()
            histogram.labels(request.method, route_label).observe(duration)
        return response

    def _healthz() -> Dict[str, Any]:
        return {"ok": True, "service": service_name}

    def _metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    _ensure_route(app, "/healthz", "GET", _healthz)
    _ensure_route(app, "/metrics", "GET", _metrics)

    app.state._apgms_observability = True
