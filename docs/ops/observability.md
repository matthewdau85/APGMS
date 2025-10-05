# Observability Guide

This document describes the instrumentation added to the payments (Express) and tax-engine (FastAPI) services.

## Trace propagation

* **Incoming HTTP** – both services accept the W3C `traceparent` header. If none is provided, a new trace is generated.
* **Express → NATS** – the payments service publishes payout events to the `apgms.payments.release.v1` subject. Each message carries the caller trace context in a `traceparent` field.
* **FastAPI → DB** – the tax-engine service extracts the `traceparent`, reuses the trace ID while generating a child span, and stores the trace ID with each `tax_calc_log` row. It republishes downstream messages with the updated `traceparent`.

## Logging

Structured JSON is emitted for all important events with the following fields:

| Field | Description |
|-------|-------------|
| `trace_id` | W3C trace identifier for correlation across services |
| `idempotency_key` | HTTP `Idempotency-Key` (if supplied) |
| `abn` / `tax_type` / `period` | Period identifiers taken from the request body |
| `duration_ms` | Per-request latency (payments service) |
| `error` | Error string for failure paths |

Logs are sent to STDOUT so they can be scraped by the platform log collector.

## Metrics

Metrics are exposed via `/metrics` on both services and are Prometheus compatible.

### Payments service metrics

* `payments_request_latency_seconds` – histogram of request latency (labels: route, method, status)
* `rpt_issued_total` – counter incremented after a successful release using a verified RPT
* `payout_attempt_total` – counter incremented for every payout attempt (success or failure)
* `anomaly_block_total` – counter incremented when the request is rejected for anomaly or validation reasons

### Tax engine metrics

* `tax_requests_total` – messages consumed from NATS
* `tax_results_total` – downstream messages published after processing
* `taxengine_calc_seconds` – histogram of end-to-end processing time
* `taxengine_db_seconds` – histogram of DB write latency
* `taxengine_nats_connected` – gauge set to `1` while the engine is connected to NATS

## Health and readiness endpoints

Both services expose:

* `GET /healthz` – lightweight check (process up, config loaded)
* `GET /readyz` – returns HTTP 200 only when all dependencies are reachable:
  * PostgreSQL (`SELECT 1` in payments, connection pool in tax-engine)
  * KMS provider (payments only – verifies `getKeyId()`)
  * NATS JetStream message bus (both services)

On failure the endpoint responds with HTTP 503 and lists dependency statuses.

## Grafana

A ready-to-import dashboard is available at `ops/grafana/dashboards/observability.json`. Panels include request latency, key counters, tax-engine throughput, and NATS connectivity status.
