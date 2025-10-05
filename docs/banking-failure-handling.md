# Banking & STP Failure Handling

This document outlines how the payments service surfaces errors when interacting with
external banking rails and the Single Touch Payroll (STP) gateway.

## Overview

1. The web application calls `POST /api/payments/bank/verify` and `POST /api/payments/stp/report`
   to obtain availability checks and STP confirmations before initiating a release.
2. The payments service uses mutual TLS (mTLS) HTTP clients to connect to both providers.
3. Idempotency keys are generated for each outbound request to ensure retriable operations.

## Failure Paths

### Insufficient Funds

* Triggered when the bank responds with HTTP 402 or `sufficient=false` during verification
  or transfer operations.
* The API responds with status **402** and error code `BANK_TRANSFER_FAILED`.
* The UI surfaces the failure message and continues to show the available balance that the
  bank returned so operators can reconcile shortages.

### STP Rejection

* Triggered when the STP provider rejects the report submission.
* The payments service responds with status **422** and error code `STP_REJECTED`.
* No changes are committed to `owa_ledger`; operators must correct the STP payload before
  retrying.

### Database Rollback

* When downstream operations succeed but writing to `owa_ledger` fails (for example because
  a unique constraint is violated) the service rolls back the transaction and returns
  status **400** with error `Release failed`.

## Testing

Automated Jest tests cover the failure modes described above in
`apps/services/payments/test/release_failures.test.ts`.

To execute the suite locally:

```bash
cd apps/services/payments
pnpm test -- release_failures
```

The tests use mocks for the STP and banking clients to verify that the service returns the
expected HTTP status codes and never commits ledger entries when upstream systems reject
requests.
