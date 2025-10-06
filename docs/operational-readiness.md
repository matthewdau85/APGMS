# Operational readiness playbook

This repository now ships automation that keeps PAYGW/GST rules, pipelines, and
observability in sync.  The highlights:

## Rules ingestion workflow
- The [`Rules ingestion guardrail`](../.github/workflows/rules-ingestion.yml) workflow
auto-detects JSON rule changes, generates a human-readable diff, and requires a
manual approval step before activation.
- The workflow publishes diff summaries back to pull requests and stores the raw
output as an artifact.
- Use the `rules_ingestion.py` helper locally to validate a new schedule:
  ```bash
  python scripts/rules_ingestion.py --compare-ref origin/main --output diff.md
  ```

## CI smoke pipeline
- [`ci-smoke.yml`](../.github/workflows/ci-smoke.yml) provisions Postgres, runs
  migrations smoke tests, golden PAYGW/GST tests, and the seed → release → evidence
  integration flow.  Evidence bundles produced during CI are preserved as build
  artifacts for audit review.
- End-to-end coverage uses the generated Ed25519 keys to verify RPT signatures and
  exercises the evidence export script so downstream consumers see a real bundle.

## Observability and SLOs
- `docker-compose.metrics.yml` now deploys Prometheus, Grafana, Loki, Tempo, and an
  OpenTelemetry collector.  Services can ship OTLP telemetry to
  `http://localhost:4318` and the collector forwards metrics/traces/logs to the stack.
- `server.js` exposes `/metrics` with release success counters, DLQ backlog gauges,
  and rule drift status.  Grafana dashboards plot these signals alongside existing
  service health metrics.
- Alerting rules fire when release success drops below 99%, when DLQ backlog is
  non-zero for 10 minutes, or when the active rule version drifts from the approved
  baseline.

## Database utilities
- `tests/test_migrations_smoke.py` executes every SQL migration in an isolated
  database to catch syntax regressions before deploy.
- `tests/test_integration_flows.py` builds a fresh dataset, issues an RPT with a
  signed token, runs the Node.js verification script, and captures the generated
  evidence JSON for regression protection.

## Local tips
1. Bring up the observability stack:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.metrics.yml up -d grafana loki tempo otel-collector
   ```
2. Point services at the collector:
   ```bash
   export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
   ```
3. Visit Grafana (`http://localhost:3000`) and open the **APGMS Overview** dashboard
   to view release SLOs, DLQ backlog, rule drift, logs, and traces.
