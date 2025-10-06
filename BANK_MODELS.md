# Bank Integration Models

This document describes the canonical objects exposed by the payments service after the bank egress refactor.  The intent is to keep a single mapping between provider-specific payloads (Direct Entry / PayTo) and the internal reconciliation models consumed by APGMS.

## Payout Request

| Field | Source | Notes |
| --- | --- | --- |
| `abn` | Release request payload | ABN of the merchant releasing the liability. |
| `taxType` | Release request payload | PAYGW, GST, etc. |
| `periodId` | Release request payload | ISO period identifier `YYYY-MM`. |
| `amountCents` | Ledger balance | Always positive when calling the bank; we negate when writing to the OWA ledger. |
| `currency` | Default `AUD` | Override only for multi-currency rails. |
| `rail` | Caller supplied | `EFT`, `BPAY`, or `PAYTO`.  Determines the adapter path. |
| `reference` | Derived | Defaults to `${abn}-${taxType}-${periodId}` if not supplied. |
| `idempotencyKey` | `sha256Hex("payato:abn:taxType:periodId")` | Stable across retries to guarantee single submission. |
| `metadata` | Mixed | Includes `release_uuid` and destination hints for bank audit trails. |

## Canonical `PayoutResult`

All rail-specific responses are normalised into the following envelope before the ledger is updated:

```ts
{
  status: 'ACCEPTED' | 'PENDING' | 'REJECTED',
  provider_code: string,
  reference: string,
  bank_txn_id?: string
}
```

* `status` is computed from either the provider `status` field or the result code.  The mapping treats values such as `ACCEPTED`, `APPROVED`, `SUCCESS`, `SETTLED`, and `00` as **ACCEPTED**; `PENDING`, `QUEUED`, `PROCESSING`, and `01` as **PENDING**; and `REJECTED`, `DECLINED`, `FAILED`, `ERROR`, and `NACK` as **REJECTED**.
* `provider_code` retains the original status/code for traceability.
* `reference` echoes the bank-side reference when supplied; otherwise the canonical release reference.
* `bank_txn_id` stores the receipt / transaction identifier if provided by the rail.  Missing identifiers fall back to the request reference.

Failures after the configured retries are written to `var/bank-egress-dlq/` as JSON with the captured request and error string.

## Bank Statements

Both mock and real adapters expose a `BankStatementsPort` with two ingestion paths:

1. **File watcher** – watches `var/mock-bank-statements/` (mock) or `var/bank-statements/` (real, overridable via `BANK_STATEMENTS_DIR`).  Files ending in `.json` or `.csv` are parsed and emitted to registered handlers.
2. **HTTP ingest** – POST `/api/bank/statements/ingest` with `{ content, filename, contentType, encoding }`.  When `encoding === "base64"` the content is decoded before parsing.

### Statement Entry Mapping

Parsed statement rows are standardised to:

| Field | Source | Notes |
| --- | --- | --- |
| `bank_txn_id` | `bank_txn_id` / `receipt_id` / `transaction_id` / `reference` | Unique identifier per credit/debit. |
| `posted_at` | `posted_at` / `date` | Defaults to ingestion time when absent. |
| `amount_cents` | `amount_cents` / `amount` | Signed integer. |
| `reference` | `reference` / `narrative` | Free-form remittance text. |
| `description` | `description` / `memo` | Optional supporting text. |
| `provider_code` | `provider_code` / `code` | Native provider status code. |

### Cutoff Rules

* The cutoff timestamp for a batch is inferred from the filename (pattern `YYYY-MM-DD`) when present; otherwise the ingestion timestamp is used.
* Files dropped before 06:00 AEST are treated as the previous banking day by downstream reconciliation jobs (implemented externally).
* Re-ingestion of the same file is idempotent at the consumer level – handlers should deduplicate using `bank_txn_id`.

## Environment Flags

| Variable | Purpose | Default |
| --- | --- | --- |
| `BANK_PROVIDER` | `mock` or `real` implementation selector | `mock` |
| `BANK_API_BASE` | Base URL for the direct-entry / PayTo API | _(required for real)_ |
| `BANK_TIMEOUT_MS` | HTTP timeout for real adapter | `8000` |
| `BANK_MAX_ATTEMPTS` | Retry attempts before DLQ | `3` |
| `BANK_RETRY_BASE_MS` | Base backoff delay | `250` |
| `BANK_STATEMENTS_DIR` | Directory watched for statements (real) | `var/bank-statements` |
| `MOCK_BANK_STATEMENTS_DIR` | Directory watched for statements (mock) | `var/mock-bank-statements` |
| `BANK_TLS_CA` / `BANK_TLS_CERT` / `BANK_TLS_KEY` | mTLS bundle for the real adapter | _optional_ |

These mappings ensure downstream reconciliation and evidence builders consume a consistent contract regardless of the bank rail.
