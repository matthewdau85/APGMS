# Idempotency Operations Guide

This prototype enables end-to-end idempotency across the Express ingress, downstream FastAPI services, and the bank egress adapter when `PROTO_ENABLE_IDEMPOTENCY=true`.

## Table schema

All components share the `idempotency_keys` table:

```
id text primary key,
first_seen_at timestamptz,
status enum('pending','applied','failed'),
response_hash text,
failure_cause text,
ttl_secs int
```

Response payloads are cached separately in `idempotency_responses (hash text primary key, status_code int, body jsonb, content_type text, headers jsonb, created_at timestamptz)`.

## Request lifecycle

1. Express middleware generates or accepts the `Idempotency-Key` and `X-Trace-Id` headers. When absent, semantic keys are derived for payment operations: `ABN:{abn}:BAS:{period}:PAYMENT:{amount_cents}`.
2. The key is inserted with `status=pending`. Duplicate requests while the original is in flight return `409 IDEMPOTENCY_IN_PROGRESS`.
3. Once the downstream call succeeds, the response body and headers are persisted and the key is marked `applied`. Subsequent calls replay the cached response.
4. Failures mark the key as `failed` and the cause is surfaced on later attempts with `409 IDEMPOTENCY_FAILED`.

The headers are forwarded to the payments service and the FastAPI egress service, ensuring consistent tracing end-to-end.

## Failure modes

* **In-progress:** Client retried before the first request completed. Response: `409` with `error=IDEMPOTENCY_IN_PROGRESS`.
* **Failed:** First attempt threw or returned an error. Subsequent retries see `409` with the stored `failure_cause`.
* **Applied:** Request succeeded; cached response is returned with original status/headers.

## Maintenance

Use `scripts/clear_idem.ps1` to purge expired idempotency keys and their cached responses:

```powershell
pwsh scripts/clear_idem.ps1 -ConnectionString "postgresql://user:pass@host:5432/db"
```

TTL defaults to 24 hours (`PROTO_IDEMPOTENCY_TTL_SECS` overrides). The purge script can be scheduled to run periodically.

## Testing

Run the concurrency regression to ensure only one side effect occurs even under load:

```bash
npm test
```

The script launches 10 concurrent operations against the idempotency store and verifies that only one call acquires the key while others observe the in-progress guard, then confirms cached replay semantics.
