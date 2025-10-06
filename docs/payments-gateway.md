# Payments gateway integration

The payments microservice that lives in `apps/services/payments` must be running for
`/api/payments/*` traffic to succeed. Start it locally with:

```bash
cd apps/services/payments
npm install
npm run dev
```

The service listens on `PORT` (default `3000`). The gateway talks to it via the
`PAYMENTS_BASE_URL` (or `NEXT_PUBLIC_PAYMENTS_BASE_URL`) environment variable. If
that variable is unset the gateway falls back to `http://localhost:3000`.

## Required environment

Set the following environment variables for the service and the gateway:

- `RPT_ED25519_SECRET_BASE64` – Base64 encoded Ed25519 private/secret key material
  used when issuing RPTs.
- `RPT_PUBLIC_BASE64` – Base64 encoded 32-byte Ed25519 public key so verification can run.
- `RATES_VERSION` – Controls the rate schedule (use `prototype` unless you have a newer tag).

You can put these values in `.env.local` at the repo root. The service loads that file
via `apps/services/payments/src/loadEnv.ts`.

## RPT headers

Release requests must prove possession of the current RPT by providing two HTTP headers:

- `X-RPT-Head` – the `payload_sha256` hash from the token record
- `X-RPT-Token` – the base64 detached signature over the canonical payload

Both headers must match the latest active token for the `(abn, taxType, periodId)` tuple.
The gateway forwards these headers to the microservice. The `rptGate` middleware rejects
requests if either header is missing or mismatched and also verifies the Ed25519
signature against the configured public key.

For convenience the gateway will also forward `rptHead` / `rptToken` values supplied
in the JSON body, allowing scripted clients to supply the values without custom headers.
