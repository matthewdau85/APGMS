# External Banking & PayTo Integration

This service talks to the bank's PSD2 / NPP sandbox so deployments must provision
credentials and callback endpoints before going live.

## API base URLs

| Purpose | Env var | Notes |
| --- | --- | --- |
| Core secure banking API (STP, balances, tax disbursement) | `BANK_API_BASE_URL` | HTTPS base URL for the bank's REST gateway. Defaults to the AusPayNet PayTo sandbox placeholder. |
| PayTo API base (mandates, debits) | `PAYTO_API_BASE_URL` | Optional – falls back to `BANK_API_BASE_URL` if omitted. |

## Client credentials

| Env var | Required | Description |
| --- | --- | --- |
| `BANK_API_CLIENT_ID` | ✅ | OAuth2 client id issued by the bank. |
| `BANK_API_CLIENT_SECRET` | ✅ | OAuth2 client secret. |
| `BANK_API_DEFAULT_DEBIT_ACCOUNT` | ✅ | Account number / alias used when debiting BAS funds. |
| `BANK_API_ACCOUNT_<ALIAS>` | ⚙️ | Map friendly aliases (e.g. `BANK_API_ACCOUNT_BUSINESSREVENUEACC`) to real account identifiers. Used by the UI helpers when moving money between one-way accounts. |
| `BANK_TLS_CA` | ⚙️ | Absolute path to the bank CA bundle (PEM). |
| `BANK_TLS_CERT` | ⚙️ | Absolute path to the client certificate for mTLS. |
| `BANK_TLS_KEY` | ⚙️ | Absolute path to the private key for mTLS. |
| `PAYTO_CLIENT_ID` / `PAYTO_CLIENT_SECRET` | ✅ (if PayTo lives on a separate tenant) | Overrides the bank client id/secret for PayTo-specific endpoints when required. |
| `PAYTO_SCOPE` | ⚙️ | Optional OAuth scope to request when exchanging PayTo credentials. |

All credentials are loaded at process start; store them in your secrets manager and inject via the runtime environment.

## Callbacks and webhooks

* **Settlement webhook** – expose `/api/settlement/webhook` publicly. The bank posts split-payment CSV payloads with the following JSON body:
  ```json
  {
    "abn": "12345678901",
    "taxType": "GST",
    "periodId": "2025-09",
    "csv": "txn_id,gst_cents,net_cents,settlement_ts\n..."
  }
  ```
  Protect the endpoint with the bank's signing secret or mutual TLS (configure via the TLS env vars above).
* **PayTo status** – the PayTo mandate lifecycle is polled via the secure client; no inbound webhook is required yet, but the bank may optionally call `/api/settlement/webhook` to indicate mandate reversals alongside settlement reversals.

## Stored artefacts

* `bank_transaction_signatures` – immutable log of signatures returned by the bank for STP submissions, one-way sweeps, and BAS payments. This table backs audit/evidence workflows.
* `split_settlement_receipts` – idempotency state for split payments received via the webhook.
* `settlement_discrepancies` – findings injected into evidence bundles (see `/api/evidence`).

Rotate OAuth tokens according to bank policy – the client performs the `client_credentials` grant automatically and caches the token for the published `expires_in` window.
